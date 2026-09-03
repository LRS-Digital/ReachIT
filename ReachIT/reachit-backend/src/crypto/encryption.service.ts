import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey || rawKey.length !== 64) {
      throw new Error(
        'ENCRYPTION_KEY muss ein 64-Zeichen langer Hex-String (32 Bytes) sein.',
      );
    }
    this.key = Buffer.from(rawKey, 'hex');
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // iv + authTag + ciphertext, alles hex-kodiert, durch ':' getrennt
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, authTagHex, dataHex] = payload.split(':');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
