// CITE-Flow custom 8-digit forgot-password flow.
// Browser → Edge Function `forgot-password-otp` (send / verify / reset).
// Does not use supabase.auth.signInWithOtp() and does not send email itself.
(() => {
  const supabaseUrl = (typeof window.__SUPABASE_URL__ === 'string' && window.__SUPABASE_URL__)
    ? window.__SUPABASE_URL__
    : 'https://uforealazougjckepggc.supabase.co';
  const supabaseAnonKey = (typeof window.__SUPABASE_ANON__ === 'string' && window.__SUPABASE_ANON__)
    ? window.__SUPABASE_ANON__
    : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

  const { createClient } = window.supabase || {};
  const supabaseClient = (createClient && supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      })
    : null;

  const emailStep = document.getElementById('emailStep');
  const otpStep = document.getElementById('otpStep');
  const resetStep = document.getElementById('resetStep');
  const successMsg = document.getElementById('successMsg');
  const formAlert = document.getElementById('formAlert');
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  const forgotForm = document.getElementById('forgotForm');

  const emailInput = document.getElementById('email');
  const otpInput = document.getElementById('otp');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');

  const sendBtn = document.getElementById('sendBtn');
  const verifyBtn = document.getElementById('verifyBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resendLink = document.getElementById('resendLink');

  const EMAIL_KEY = 'citeflow_password_reset_email';
  const TOKEN_KEY = 'citeflow_password_reset_token';

  const COPY = {
    email: {
      title: 'Forgot Password?',
      subtitle: "No worries! Enter your registered email and we'll send you a verification code."
    },
    otp: {
      title: 'Enter Verification Code',
      subtitle: 'Enter the 8-digit code we sent to your registered email.'
    },
    reset: {
      title: 'Set a New Password',
      subtitle: 'Choose a new password for your CITE-Flow account.'
    }
  };

  function show(el) {
    if (!el) return;
    el.style.display = '';
  }

  function hide(el) {
    if (!el) return;
    el.style.display = 'none';
  }

  function setBusy(button, busy, textWhenBusy) {
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busy && textWhenBusy) button.textContent = textWhenBusy;
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function getEmailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('email') || '';
  }

  function readEmail() {
    return normalizeEmail(sessionStorage.getItem(EMAIL_KEY) || (emailInput && emailInput.value) || '');
  }

  function storeEmail(email) {
    sessionStorage.setItem(EMAIL_KEY, email);
  }

  function readResetToken() {
    return String(sessionStorage.getItem(TOKEN_KEY) || '');
  }

  function storeResetToken(token) {
    if (!token) {
      sessionStorage.removeItem(TOKEN_KEY);
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearResetState() {
    sessionStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function setAlert(message, kind) {
    if (!formAlert) return;
    const text = String(message || '').trim();
    if (!text) {
      formAlert.style.display = 'none';
      formAlert.textContent = '';
      formAlert.className = 'form-alert';
      return;
    }
    formAlert.className = 'form-alert ' + (kind === 'success' ? 'success' : 'error');
    formAlert.textContent = text;
    formAlert.style.display = 'block';
  }

  function setSuccessBanner(visible) {
    if (!successMsg) return;
    successMsg.style.display = visible ? 'block' : 'none';
  }

  function setCopy(step) {
    const next = COPY[step];
    if (!next) return;
    if (titleEl) titleEl.textContent = next.title;
    if (subtitleEl) subtitleEl.textContent = next.subtitle;
  }

  function showStep(step) {
    hide(emailStep);
    hide(otpStep);
    hide(resetStep);
    setCopy(step);
    if (step === 'email') {
      show(emailStep);
      setSuccessBanner(false);
    } else if (step === 'otp') {
      show(otpStep);
      setSuccessBanner(true);
    } else if (step === 'reset') {
      show(resetStep);
      setSuccessBanner(false);
    }
  }

  function friendlyMessage(code, backendMessage) {
    const raw = String(backendMessage || '').trim();
    const looksInternal = /sql|stack|service.?role|postgres|digest|auth\.users|password_reset_otps|jwt|edge function|function was not found|NOT_FOUND/i.test(raw);

    if (code === 'invalid_email') return 'Invalid email';
    if (code === 'not_registered') return 'Account not found';
    if (code === 'rate_limited') {
      if (/too many reset/i.test(raw)) return 'Too many reset requests';
      return 'Please wait before requesting another code';
    }
    if (code === 'invalid_otp') return 'Invalid verification code';
    if (code === 'expired_otp') return 'Verification code expired';
    if (code === 'too_many_attempts') return 'Too many incorrect attempts';
    if (code === 'invalid_reset') return 'Password reset failed';
    if (code === 'network') return 'Unable to reach the server. Please check your connection and try again.';

    if (raw && !looksInternal) return raw;
    return 'Something went wrong. Please try again.';
  }

  async function callForgotPassword(payload) {
    const endpoint = `${supabaseUrl}/functions/v1/forgot-password-otp`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify(payload)
      });
    } catch (_networkError) {
      const err = new Error(friendlyMessage('network'));
      err.code = 'network';
      throw err;
    }

    let body = {};
    try {
      body = await response.json();
    } catch (_parseError) {
      body = {};
    }

    if (response.ok && body && body.ok === true) {
      return body;
    }

    const gatewayMissing = body.code === 'NOT_FOUND'
      || /function was not found/i.test(String(body.message || ''));
    const code = gatewayMissing
      ? 'server_error'
      : (body.error || (response.status === 429 ? 'rate_limited' : 'server_error'));
    const err = new Error(friendlyMessage(code, gatewayMissing ? '' : body.message));
    err.code = code;
    throw err;
  }

  function passwordMeetsPolicy(password) {
    return password.length >= 8
      && /[A-Z]/.test(password)
      && /[a-z]/.test(password)
      && /[0-9]/.test(password);
  }

  async function sendOtp(email) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setAlert('Invalid email');
      return false;
    }

    setBusy(sendBtn, true, 'Sending...');
    setBusy(resendLink, true);
    setAlert('');
    try {
      await callForgotPassword({ action: 'send', email: normalized });
      storeEmail(normalized);
      storeResetToken('');
      if (emailInput) emailInput.value = normalized;
      if (otpInput) otpInput.value = '';
      showStep('otp');
      return true;
    } catch (error) {
      setAlert(error && error.message ? error.message : 'Failed to send verification code. Please try again.');
      return false;
    } finally {
      setBusy(sendBtn, false);
      if (sendBtn) sendBtn.textContent = 'Send Verification Code';
      setBusy(resendLink, false);
    }
  }

  async function verifyOtp() {
    const email = readEmail();
    const otp = String((otpInput && otpInput.value) || '').replace(/\D/g, '');

    if (!email) {
      setAlert('Please enter your email first.');
      showStep('email');
      return;
    }
    if (!/^\d{8}$/.test(otp)) {
      setAlert('Please enter the 8-digit code from your email.');
      return;
    }

    setBusy(verifyBtn, true, 'Verifying...');
    setAlert('');
    try {
      const result = await callForgotPassword({ action: 'verify', email, otp });
      const resetToken = String(result.resetToken || '');
      if (!resetToken) {
        throw Object.assign(new Error('Password reset failed'), { code: 'invalid_reset' });
      }
      storeEmail(email);
      storeResetToken(resetToken);
      if (otpInput) otpInput.value = '';
      if (newPasswordInput) newPasswordInput.value = '';
      if (confirmPasswordInput) confirmPasswordInput.value = '';
      showStep('reset');
    } catch (error) {
      storeResetToken('');
      setAlert(error && error.message ? error.message : 'Invalid verification code');
      if (error && (error.code === 'expired_otp' || error.code === 'too_many_attempts')) {
        showStep('otp');
      }
    } finally {
      setBusy(verifyBtn, false);
      if (verifyBtn) verifyBtn.textContent = 'Verify Code';
    }
  }

  async function resetPassword() {
    const email = readEmail();
    const resetToken = readResetToken();
    const newPassword = String((newPasswordInput && newPasswordInput.value) || '');
    const confirmPassword = String((confirmPasswordInput && confirmPasswordInput.value) || '');

    if (!email || !resetToken) {
      setAlert('Please verify the 8-digit code before resetting your password.');
      showStep(email ? 'otp' : 'email');
      return;
    }
    if (!newPassword) {
      setAlert('Please enter a new password.');
      return;
    }
    if (!passwordMeetsPolicy(newPassword)) {
      setAlert('Password must be at least 8 characters and include uppercase, lowercase, and a number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setAlert('Passwords do not match.');
      return;
    }

    setBusy(resetBtn, true, 'Resetting...');
    setAlert('');
    try {
      await callForgotPassword({
        action: 'reset',
        email,
        resetToken,
        password: newPassword
      });
      clearResetState();
      if (supabaseClient) {
        try {
          await supabaseClient.auth.signOut();
        } catch (_signOutError) {
          // Ignore leftover-session errors after a successful custom reset.
        }
      }
      setAlert('Password successfully reset. You can now log in with your new password.', 'success');
      window.setTimeout(() => {
        window.location.href = 'login.html';
      }, 1200);
    } catch (error) {
      setAlert(error && error.message ? error.message : 'Password reset failed');
      if (error && (error.code === 'expired_otp' || error.code === 'invalid_reset')) {
        storeResetToken('');
      }
    } finally {
      setBusy(resetBtn, false);
      if (resetBtn) resetBtn.textContent = 'Reset Password';
    }
  }

  sendBtn?.addEventListener('click', () => sendOtp(emailInput && emailInput.value));
  verifyBtn?.addEventListener('click', verifyOtp);
  resetBtn?.addEventListener('click', resetPassword);
  resendLink?.addEventListener('click', (event) => {
    event.preventDefault();
    const email = readEmail();
    if (!email) {
      setAlert('Please enter your email first.');
      showStep('email');
      return;
    }
    sendOtp(email);
  });

  otpInput?.addEventListener('input', () => {
    otpInput.value = String(otpInput.value || '').replace(/\D/g, '').slice(0, 8);
  });

  forgotForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (emailStep && emailStep.style.display !== 'none') {
      sendOtp(emailInput && emailInput.value);
      return;
    }
    if (otpStep && otpStep.style.display !== 'none') {
      verifyOtp();
      return;
    }
    if (resetStep && resetStep.style.display !== 'none') {
      resetPassword();
    }
  });

  function init() {
    const urlEmail = normalizeEmail(getEmailFromUrl());
    const storedEmail = normalizeEmail(sessionStorage.getItem(EMAIL_KEY));
    const storedToken = readResetToken();
    const effectiveEmail = urlEmail || storedEmail || '';

    if (effectiveEmail && emailInput) {
      emailInput.value = effectiveEmail;
    }

    const params = new URLSearchParams(window.location.search);
    const autoSend = params.get('autoSend') === '1';
    if (effectiveEmail && autoSend) {
      sendOtp(effectiveEmail);
      return;
    }

    if (storedEmail && storedToken) {
      showStep('reset');
      return;
    }

    if (storedEmail) {
      showStep('otp');
      return;
    }

    showStep('email');
    setAlert('');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
