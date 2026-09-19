"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockEmailProvider = void 0;
class MockEmailProvider {
    name = 'MockEmailProvider';
    async sendSecureDocumentLink(options) {
        console.log(`[MockEmailProvider]: Secure delivery notification sent to ${options.to}`);
        console.log(`[Link]: ${options.secureDocumentUrl} (Expires in ${options.expiresInMinutes} minutes)`);
    }
}
exports.MockEmailProvider = MockEmailProvider;
