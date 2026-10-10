import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** What an instructor must never see. Names are matched on any object in a response, however deeply it is nested. */
const HIDDEN_FOR_INSTRUCTORS = new Set(['fee']);

function strip(value: any): any {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) if (!HIDDEN_FOR_INSTRUCTORS.has(k)) out[k] = strip(v);
    return out;
  }
  return value; // dates, buffers and streamed files are left alone
}

/**
 * Instructors teach; they are not told what a place costs. Hiding it on the screen is not enough, so the price is removed
 * from every response the API sends to an instructor, whichever endpoint it came from.
 */
@Injectable()
export class FeeHidingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const role = ctx.switchToHttp().getRequest()?.user?.role;
    return role === 'instructor' ? next.handle().pipe(map(strip)) : next.handle();
  }
}
