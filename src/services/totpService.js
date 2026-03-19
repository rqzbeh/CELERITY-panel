const QRCode = require('qrcode');
const otplib = require('otplib');
const cryptoService = require('./cryptoService');

const DEFAULT_ISSUER = 'C3 CELERITY';

class TotpService {
    generateSecret() {
        return otplib.generateSecret();
    }

    encryptSecret(secret) {
        return cryptoService.encrypt(secret);
    }

    decryptSecret(secretEncrypted) {
        return cryptoService.decrypt(secretEncrypted);
    }

    buildOtpAuthUrl({ secret, username, issuer = DEFAULT_ISSUER }) {
        return otplib.generateURI({ secret, accountName: String(username), issuer });
    }

    async generateQrDataUrl(otpauthUrl) {
        return QRCode.toDataURL(otpauthUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 220,
        });
    }

    async verifyToken({ secret, token }) {
        const normalizedToken = String(token || '').replace(/\s+/g, '');
        if (!normalizedToken) return false;

        const verificationResult = await otplib.verify({
            token: normalizedToken,
            secret,
        });

        if (typeof verificationResult === 'boolean') {
            return verificationResult;
        }

        return Boolean(verificationResult && verificationResult.valid);
    }

    async generateEnrollmentData({ username, issuer = DEFAULT_ISSUER }) {
        const secret = this.generateSecret();
        const secretEncrypted = this.encryptSecret(secret);
        const otpauthUrl = this.buildOtpAuthUrl({ secret, username, issuer });
        const qrDataUrl = await this.generateQrDataUrl(otpauthUrl);

        return {
            secret,
            secretEncrypted,
            otpauthUrl,
            qrDataUrl,
        };
    }
}

module.exports = new TotpService();