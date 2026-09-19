"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeliveryService = void 0;
const storage_1 = require("../providers/storage");
const email_1 = require("../providers/email");
class DeliveryService {
    storage = (0, storage_1.getStorageProvider)();
    email = (0, email_1.getEmailProvider)();
    async deliverSecureDocumentLink(recipientEmail, recipientName, documentKey, expiresInMinutes = 15) {
        const signedUrl = await this.storage.getSignedUrl(documentKey, expiresInMinutes * 60);
        await this.email.sendSecureDocumentLink({
            to: recipientEmail,
            subject: 'Vabatim Secure Clinical Document Link',
            recipientName,
            secureDocumentUrl: signedUrl,
            expiresInMinutes
        });
        return signedUrl;
    }
}
exports.DeliveryService = DeliveryService;
