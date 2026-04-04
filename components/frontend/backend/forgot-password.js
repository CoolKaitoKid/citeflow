// Initialize EmailJS with your Public Key
(function() {
  emailjs.init("YOUR_PUBLIC_KEY_HERE");   // ← Replace with your EmailJS Public Key
})();

const emailStep = document.getElementById('emailStep');
const otpStep = document.getElementById('otpStep');
const successMsg = document.getElementById('successMsg');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');

let currentEmail = '';
let generatedOTP = '';   // For demo verification (in production, verify on backend)

// Send OTP
document.getElementById('sendBtn').addEventListener('click', async function() {
  const emailInput = document.getElementById('email').value.trim();
  
  if (!emailInput || !emailInput.endsWith('@ctu.edu.ph')) {
    alert("Please enter a valid CTU email (e.g., name@ctu.edu.ph)");
    return;
  }

  currentEmail = emailInput;

  // Generate 6-digit OTP
  generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Show loading (you can add a spinner if you want)
    document.getElementById('sendBtn').textContent = "Sending...";
    document.getElementById('sendBtn').disabled = true;

    await emailjs.send("YOUR_SERVICE_ID", "YOUR_TEMPLATE_ID", {
      to_email: currentEmail,
      otp_code: generatedOTP,
      // You can add more fields like user_name if you want
    });

    successMsg.style.display = 'block';

    // Switch to OTP step after short delay
    setTimeout(() => {
      emailStep.style.display = 'none';
      otpStep.style.display = 'block';
      title.textContent = "Enter Verification Code";
      subtitle.textContent = `We sent a 6-digit code to ${currentEmail}. Enter it below.`;
      successMsg.style.display = 'none';
      document.getElementById('sendBtn').textContent = "Send Verification Code";
      document.getElementById('sendBtn').disabled = false;
    }, 1500);

  } catch (error) {
    console.error("EmailJS Error:", error);
    alert("Failed to send email. Please check your EmailJS configuration.");
    document.getElementById('sendBtn').textContent = "Send Verification Code";
    document.getElementById('sendBtn').disabled = false;
  }
});

// Verify OTP
document.getElementById('verifyBtn').addEventListener('click', function() {
  const enteredOTP = document.getElementById('otp').value.trim();

  if (enteredOTP === generatedOTP) {
    alert("✅ Code verified successfully!\n\nYou can now reset your password.");
    // In a real app: window.location.href = "reset-password.html";
  } else {
    alert("Invalid or expired code. Please try again.");
  }
});

// Resend OTP
document.getElementById('resendLink').addEventListener('click', function(e) {
  e.preventDefault();
  if (currentEmail) {
    // Reuse the send logic (you can extract it to a function for cleaner code)
    document.getElementById('sendBtn').click();  // Simple way to reuse
    alert("New verification code sent!");
  }
});