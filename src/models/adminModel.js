/**
 * Admin model (bcrypt hashed password)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
    },
    passwordHash: {
        type: String,
        required: true,
    },
    twoFactor: {
        enabled: {
            type: Boolean,
            default: false,
        },
        secretEncrypted: {
            type: String,
            default: null,
        },
        enabledAt: {
            type: Date,
            default: null,
        },
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    lastLogin: {
        type: Date,
        default: null,
    },
});


adminSchema.statics.createAdmin = async function(username, password, options = {}) {
    const hash = await bcrypt.hash(password, 12);
    const twoFactor = options.twoFactor || {};

    return this.create({
        username: username.toLowerCase().trim(),
        passwordHash: hash,
        twoFactor: {
            enabled: Boolean(twoFactor.enabled),
            secretEncrypted: twoFactor.secretEncrypted || null,
            enabledAt: twoFactor.enabledAt || null,
        },
    });
};

adminSchema.statics.verifyPassword = async function(username, password) {
    const admin = await this.findOne({ username: username.toLowerCase().trim() });
    if (!admin) return null;
    
    const isValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isValid) return null;
    
    return admin;
};

adminSchema.statics.hasAdmin = async function() {
    const count = await this.countDocuments();
    return count > 0;
};

adminSchema.statics.changePassword = async function(username, newPassword) {
    const hash = await bcrypt.hash(newPassword, 12);
    return this.changePasswordWithHash(username, hash);
};

adminSchema.statics.changePasswordWithHash = async function(username, passwordHash) {
    return this.findOneAndUpdate(
        { username: username.toLowerCase().trim() },
        { passwordHash },
        { new: true }
    );
};

adminSchema.statics.recordSuccessfulLogin = async function(username) {
    return this.findOneAndUpdate(
        { username: username.toLowerCase().trim() },
        { lastLogin: new Date() },
        { new: true }
    );
};

adminSchema.statics.createAdminWithHash = async function(username, passwordHash, options = {}) {
    const twoFactor = options.twoFactor || {};

    return this.create({
        username: username.toLowerCase().trim(),
        passwordHash,
        twoFactor: {
            enabled: Boolean(twoFactor.enabled),
            secretEncrypted: twoFactor.secretEncrypted || null,
            enabledAt: twoFactor.enabledAt || null,
        },
    });
};

adminSchema.statics.setTwoFactorEnabled = async function(username, secretEncrypted, enabledAt = new Date()) {
    return this.findOneAndUpdate(
        { username: username.toLowerCase().trim() },
        {
            twoFactor: {
                enabled: true,
                secretEncrypted,
                enabledAt,
            },
        },
        { new: true }
    );
};

adminSchema.statics.clearTwoFactor = async function(username) {
    return this.findOneAndUpdate(
        { username: username.toLowerCase().trim() },
        {
            twoFactor: {
                enabled: false,
                secretEncrypted: null,
                enabledAt: null,
            },
        },
        { new: true }
    );
};

module.exports = mongoose.model('Admin', adminSchema);