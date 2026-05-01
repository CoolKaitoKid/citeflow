// Supabase OTP-based password reset (email 6-digit code)
(() => {
  const supabaseUrl = 'https://uforealazougjckepggc.supabase.co';
  const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';
  const { createClient } = window.supabase;
  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  const emailStep = document.getElementById('emailStep');
  const otpStep = document.getElementById('otpStep');
  const resetStep = document.getElementById('resetStep');
  const successMsg = document.getElementById('successMsg');

  const emailInput = document.getElementById('email');
  const otpInput = document.getElementById('otp');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');

  const sendBtn = document.getElementById('sendBtn');
  const verifyBtn = document.getElementById('verifyBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resendLink = document.getElementById('resendLink');

  const STORAGE_KEY = 'citeflow_password_reset_email';

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

  function getEmailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('email') || '';
  }

  async function sendOtp(email) {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      alert('Please enter a valid email address.');
      return false;
    }

    setBusy(sendBtn, true, 'Sending...');
    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email: normalized,
        options: {
          shouldCreateUser: false
        }
      });
      if (error) throw error;

      sessionStorage.setItem(STORAGE_KEY, normalized);
      hide(emailStep);
      show(otpStep);
      hide(resetStep);
      otpInput.value = '';
      successMsg.style.display = 'block';
      return true;
    } catch (error) {
      console.error('sendOtp error:', error);
      alert(error?.message || 'Failed to send verification code. Please try again.');
      return false;
    } finally {
      setBusy(sendBtn, false);
      sendBtn.textContent = 'Send Verification Code';
    }
  }

  async function verifyOtp() {
    const email = normalizeEmail(sessionStorage.getItem(STORAGE_KEY) || emailInput.value);
    const token = String(otpInput.value || '').trim();

    if (!email) {
      alert('Please enter your email first.');
      return;
    }
    if (!/^\d{6}$/.test(token)) {
      alert('Please enter the 6-digit code from your email.');
      return;
    }

    setBusy(verifyBtn, true, 'Verifying...');
    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });
      if (error) throw error;
      if (!data?.user) {
        throw new Error('Verification failed. Please request a new code and try again.');
      }

      hide(emailStep);
      hide(otpStep);
      show(resetStep);
      successMsg.style.display = 'none';
      newPasswordInput.value = '';
      confirmPasswordInput.value = '';
    } catch (error) {
      console.error('verifyOtp error:', error);
      alert(error?.message || 'Invalid or expired code. Please request a new one.');
    } finally {
      setBusy(verifyBtn, false);
      verifyBtn.textContent = 'Verify Code';
    }
  }

  async function resetPassword() {
    const newPassword = String(newPasswordInput.value || '');
    const confirmPassword = String(confirmPasswordInput.value || '');

    if (newPassword.length < 8) {
      alert('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match.');
      return;
    }

    setBusy(resetBtn, true, 'Resetting...');
    try {
      const { error } = await supabaseClient.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;

      sessionStorage.removeItem(STORAGE_KEY);
      await supabaseClient.auth.signOut();

      alert('Password reset successful. Please login with your new password.');
      window.location.href = 'login.html';
    } catch (error) {
      console.error('resetPassword error:', error);
      alert(error?.message || 'Password reset failed. Please try again.');
    } finally {
      setBusy(resetBtn, false);
      resetBtn.textContent = 'Reset Password';
    }
  }

  // Wire UI events
  sendBtn?.addEventListener('click', () => sendOtp(emailInput.value));
  verifyBtn?.addEventListener('click', verifyOtp);
  resetBtn?.addEventListener('click', resetPassword);
  resendLink?.addEventListener('click', (e) => {
    e.preventDefault();
    const email = normalizeEmail(sessionStorage.getItem(STORAGE_KEY) || emailInput.value);
    if (!email) {
      alert('Please enter your email first.');
      return;
    }
    sendOtp(email);
  });

  // Prefill from query or prior session
  window.addEventListener('DOMContentLoaded', () => {
    const urlEmail = normalizeEmail(getEmailFromUrl());
    const storedEmail = normalizeEmail(sessionStorage.getItem(STORAGE_KEY));
    const effectiveEmail = urlEmail || storedEmail || '';

    if (effectiveEmail) {
      emailInput.value = effectiveEmail;
    }

    // If coming from admin "change password", we can immediately send the OTP.
    const params = new URLSearchParams(window.location.search);
    const autoSend = params.get('autoSend') === '1';
    if (effectiveEmail && autoSend) {
      sendOtp(effectiveEmail);
      return;
    }

    // If we already sent an OTP in this session, show the OTP step.
    if (storedEmail) {
      hide(emailStep);
      show(otpStep);
      hide(resetStep);
      successMsg.style.display = 'block';
    } else {
      show(emailStep);
      hide(otpStep);
      hide(resetStep);
      successMsg.style.display = 'none';
    }
  });
})();

