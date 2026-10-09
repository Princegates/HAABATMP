import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

const PG_MAP: Record<string, { status: number; message: string }> = {
  '23505': { status: 409, message: 'A record with these details already exists' },
  '23503': { status: 409, message: 'This record is linked to other data and cannot be changed that way' },
  '23514': { status: 400, message: 'A value is outside the allowed range' },
  '23502': { status: 400, message: 'A required value is missing' },
  '22P02': { status: 400, message: 'A value has the wrong format' },
  '23P01': { status: 409, message: 'That time or resource is already booked' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');

  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { statusCode: err.getStatus(), message: body } : body);
    }
    const pg = err?.code && PG_MAP[err.code];
    if (pg) {
      return res.status(pg.status).json({ statusCode: pg.status, message: pg.message, constraint: err.constraint });
    }
    this.log.error(err?.stack ?? String(err));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Something went wrong on our side' });
  }
}
