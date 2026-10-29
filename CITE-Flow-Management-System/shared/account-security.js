/* Reused account security actions: password, 2FA, sign out */
(function initCiteFlowAccountSecurity() {
    let currentTotpFactor = null;
    let pendingTotpEnrollment = null;
    let pendingTotpChallenge = null;

    function getClient() {
        return window.supabaseClient || null;
    }

    function loginHref() {
        const path = String(window.location.pathname || '').toLowerCase();
        if (path.includes('/admin/') || path.includes('/faculty/')) return '../login.html';
        return 'login.html';
    }

    function forgotHref(email) {
        const path = String(window.location.pathname || '').toLowerCase();
        const base = (path.includes('/admin/') || path.includes('/faculty/')) ? '../forgot.html' : 'forgot.html';
        return `${base}?email=${encodeURIComponent(email)}&autoSend=1`;
    }

    function setTwoFaLabel(text) {
        const label = document.getElementById('twofa-toggle-label');
        const button = document.getElementById('twofa-toggle-btn');
        if (label) label.textContent = text;
        else if (button && !button.querySelector('svg')) button.textContent = text;
    }

    async function refresh2FAStatus() {
        const statusText = document.getElementById('twofa-status-text');
        const button = document.getElementById('twofa-toggle-btn');
        currentTotpFactor = null;
        const sb = getClient();
        if (!sb?.auth || !button) return;

        try {
            const { data, error } = await sb.auth.mfa.listFactors();
            if (error) throw error;
            const totpFactors = Array.isArray(data?.totp) ? data.totp : [];
            currentTotpFactor = totpFactors.find((factor) => factor.status === 'verified') || null;
            if (currentTotpFactor) {
                setTwoFaLabel('Disable');
                if (statusText) statusText.textContent = 'Two-factor authentication is enabled for your account.';
            } else {
                setTwoFaLabel('Enable');
                if (statusText) statusText.textContent = 'Add an extra layer of security to your account.';
            }
        } catch (error) {
            console.error('CiteFlowAccountSecurity.refresh2FAStatus:', error);
            setTwoFaLabel('Enable');
            if (statusText) statusText.textContent = 'Unable to load 2FA status right now.';
        }
    }

    function closeTwoFAModal() {
        const modal = document.getElementById('twofa-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        const code = document.getElementById('twofa-code');
        if (code) code.value = '';
        const qr = document.getElementById('twofa-qr-container');
        if (qr) qr.innerHTML = 'Generating QR code...';
    }

    async function changePassword() {
        const sb = getClient();
        if (!sb?.auth) {
            alert('You must be signed in to change your password.');
            return;
        }
        const { data } = await sb.auth.getUser();
        const email = data?.user?.email || '';
        if (!email) {
            alert('No signed-in account found.');
            return;
        }
        sessionStorage.setItem('citeflow_password_reset_email', email.toLowerCase());
        window.location.href = forgotHref(email);
    }

    async function signOutUser() {
        if (!confirm('Sign out of CITE-Flow?')) return;
        if (window.CiteFlowAuth && typeof window.CiteFlowAuth.logout === 'function') {
            await window.CiteFlowAuth.logout();
            return;
        }
        const sb = getClient();
        if (sb?.auth) {
            const { error } = await sb.auth.signOut();
            if (error) {
                alert(`Sign out failed: ${error.message}`);
                return;
            }
        }
        window.location.href = loginHref();
    }

    async function toggle2FA() {
        const button = document.getElementById('twofa-toggle-btn');
        const sb = getClient();
        if (!sb?.auth || !button) return;
        button.disabled = true;
        try {
            if (currentTotpFactor) {
                if (!confirm('Disable Two-Factor Authentication for this account?')) return;
                const { error } = await sb.auth.mfa.unenroll({ factorId: currentTotpFactor.id });
                if (error) throw error;
                alert('Two-factor authentication has been disabled.');
                await refresh2FAStatus();
                return;
            }

            const { data: enrollData, error: enrollError } = await sb.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: 'CITE-Flow Authenticator'
            });
            if (enrollError) throw enrollError;

            pendingTotpEnrollment = enrollData;
            const { data: challengeData, error: challengeError } = await sb.auth.mfa.challenge({
                factorId: enrollData.id
            });
            if (challengeError) throw challengeError;
            pendingTotpChallenge = challengeData;

            const qrContainer = document.getElementById('twofa-qr-container');
            if (qrContainer) {
                if (enrollData?.totp?.qr_code) {
                    qrContainer.innerHTML = enrollData.totp.qr_code;
                } else if (enrollData?.totp?.uri) {
                    qrContainer.innerHTML = `
                        <div class="text-center space-y-2">
                            <p class="text-sm text-slate-600">Manual setup URI:</p>
                            <p class="text-xs break-all text-slate-700">${enrollData.totp.uri}</p>
                        </div>`;
                } else {
                    qrContainer.textContent = 'QR code unavailable. Please retry setup.';
                }
            }

            const modal = document.getElementById('twofa-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        } catch (error) {
            console.error('CiteFlowAccountSecurity.toggle2FA:', error);
            alert(`Two-factor setup failed: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    async function verify2FA(event) {
        event.preventDefault();
        const sb = getClient();
        if (!pendingTotpEnrollment || !pendingTotpChallenge || !sb?.auth) {
            alert('2FA setup session expired. Please try enabling again.');
            closeTwoFAModal();
            return;
        }

        const code = (document.getElementById('twofa-code')?.value || '').trim();
        if (!/^\d{6,8}$/.test(code)) {
            alert('Please enter a valid authentication code.');
            return;
        }

        const verifyButton = document.getElementById('twofa-verify-btn');
        if (verifyButton) {
            verifyButton.disabled = true;
            verifyButton.textContent = 'Verifying...';
        }

        try {
            const { error } = await sb.auth.mfa.verify({
                factorId: pendingTotpEnrollment.id,
                challengeId: pendingTotpChallenge.id,
                code
            });
            if (error) throw error;
            alert('Two-factor authentication enabled successfully.');
            pendingTotpEnrollment = null;
            pendingTotpChallenge = null;
            closeTwoFAModal();
            await refresh2FAStatus();
        } catch (error) {
            console.error('CiteFlowAccountSecurity.verify2FA:', error);
            alert(`Verification failed: ${error.message}`);
        } finally {
            if (verifyButton) {
                verifyButton.disabled = false;
                verifyButton.textContent = 'Verify and Enable';
            }
        }
    }

    function bind() {
        document.getElementById('settings-change-password')?.addEventListener('click', changePassword);
        document.getElementById('twofa-toggle-btn')?.addEventListener('click', toggle2FA);
        document.getElementById('settings-sign-out')?.addEventListener('click', signOutUser);
        document.getElementById('twofa-verify-form')?.addEventListener('submit', verify2FA);
        document.getElementById('twofa-modal-close')?.addEventListener('click', closeTwoFAModal);
        document.getElementById('twofa-modal-cancel')?.addEventListener('click', closeTwoFAModal);
        if (document.getElementById('twofa-toggle-btn')) refresh2FAStatus();
    }

    window.CiteFlowAccountSecurity = {
        changePassword,
        signOutUser,
        toggle2FA,
        closeTwoFAModal,
        refresh2FAStatus,
        bind
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
