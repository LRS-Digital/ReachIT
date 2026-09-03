import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Prüft den Supabase-Access-Token aus dem Authorization-Header und hängt die
 * Nutzer-ID an den Request. Ab hier stammt `userId` nie mehr aus Query oder
 * Body, sondern ausschließlich aus dem Token.
 *
 * Die Prüfung läuft über `auth.getUser(token)`, also einen Rückruf beim
 * Supabase-Auth-Server, statt über eine lokale Signaturprüfung. Das kostet
 * einen Roundtrip, erkennt dafür aber auch abgemeldete und gesperrte
 * Sitzungen - bei Post-Vorgängen, die ohnehin Sekunden bei den Plattformen
 * verbringen, fällt das nicht ins Gewicht.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Kein Bearer-Token im Authorization-Header.',
      );
    }

    const token = header.slice('Bearer '.length).trim();
    const { data, error } = await this.supabase.client.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Token ungültig oder abgelaufen.');
    }

    request.userId = data.user.id;
    return true;
  }
}
