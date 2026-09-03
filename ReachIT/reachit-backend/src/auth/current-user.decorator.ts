import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './supabase-auth.guard.js';

/**
 * Liefert die Nutzer-ID aus dem geprüften Token. Nur in Handlern gültig, die
 * hinter dem SupabaseAuthGuard hängen - ohne den Guard ist der Wert undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.userId!;
  },
);
