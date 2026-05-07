(() => {
  const supabaseUrl = 'https://uforealazougjckepggc.supabase.co';
  const supabaseAnonKey='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';
  const { createClient } = window.supabase;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

  const STORAGE_KEY = 'password_reset_email';
  const OTP_LENGTH = 8; // now 8 digits

  function show(el){ if(el) el.style.display = ''; }
  function hide(el){ if(el) el.style.display = 'none'; }

  function normalizeEmail(email){
    return String(email || '').trim().toLowerCase();
  }

  async function sendOtp(email){
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      alert('Enter a valid email.');
      return false;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: { shouldCreateUser: false }
      });
      if(error) throw error;

      sessionStorage.setItem(STORAGE_KEY, normalized);
      hide(emailStep);
      show(otpStep);
      hide(resetStep);
      otpInput.value = '';
      successMsg.style.display = 'block';
      return true;
    } catch(err){
      console.error(err);
      alert(err.message || 'Failed to send code.');
      return false;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Verification Code';
    }
  }

  async function verifyOtp(){
    const email = normalizeEmail(sessionStorage.getItem(STORAGE_KEY) || emailInput.value);
    const token = String(otpInput.value || '').replace(/\D/g,'').slice(0, OTP_LENGTH);

    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(token)){
      alert(`Enter the ${OTP_LENGTH}-digit code from your email.`);
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });
      if(error) throw error;

      hide(emailStep);
      hide(otpStep);
      show(resetStep);
      successMsg.style.display = 'none';
    } catch(err){
      console.error(err);
      alert(err.message || 'Invalid or expired code.');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify Code';
    }
  }

  async function resetPassword(){
    const password = newPasswordInput.value || '';
    const confirm = confirmPasswordInput.value || '';
    if(password.length < 8){
      alert('Password must be at least 8 characters.');
      return;
    }
    if(password !== confirm){
      alert('Passwords do not match.');
      return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Resetting...';
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if(error) throw error;

      sessionStorage.removeItem(STORAGE_KEY);
      await supabase.auth.signOut();

      alert('Password reset successful.');
      window.location.href = 'login.html';
    } catch(err){
      console.error(err);
      alert(err.message || 'Password reset failed.');
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Reset Password';
    }
  }

  sendBtn.addEventListener('click', () => sendOtp(emailInput.value));
  verifyBtn.addEventListener('click', verifyOtp);
  resetBtn.addEventListener('click', resetPassword);
  otpInput.addEventListener('input', () => {
    otpInput.value = otpInput.value.replace(/\D/g,'').slice(0, OTP_LENGTH);
  });
  resendLink.addEventListener('click', e => {
    e.preventDefault();
    sendOtp(sessionStorage.getItem(STORAGE_KEY) || emailInput.value);
  });

  window.addEventListener('DOMContentLoaded', () => {
    const email = sessionStorage.getItem(STORAGE_KEY) || '';
    if(email) emailInput.value = email;
  });

})();