import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { Response } from 'express';

import { getErrorCode } from '../constants/error-codes';

interface ExceptionBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

interface PrismaKnownError {
  code: string;
  meta?: Record<string, unknown>;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, code, message, data } = this.normalizeException(exception);

    response.status(status).json({
      code,
      message,
      data
    });
  }

  private normalizeException(exception: unknown) {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const parsedBody = typeof body === 'object' && body !== null ? (body as ExceptionBody) : undefined;

      if (status === HttpStatus.BAD_REQUEST && Array.isArray(parsedBody?.message)) {
        return {
          status,
          code: getErrorCode(status),
          message: '参数错误',
          data: {
            errors: parsedBody.message
          }
        };
      }

      return {
        status,
        code: getErrorCode(status),
        message: this.resolveHttpMessage(status, body, exception.message),
        data: {}
      };
    }

    if (this.isPrismaKnownRequestError(exception) && exception.code === 'P2002') {
      return {
        status: HttpStatus.CONFLICT,
        code: getErrorCode(HttpStatus.CONFLICT),
        message: '数据冲突',
        data: {
          target: exception.meta?.target
        }
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: getErrorCode(HttpStatus.INTERNAL_SERVER_ERROR),
      message: '服务端错误',
      data: {}
    };
  }

  private resolveHttpMessage(status: number, responseBody: string | object, fallback: string): string {
    if (status === HttpStatus.NOT_FOUND) {
      return '资源不存在';
    }

    if (typeof responseBody === 'string') {
      return responseBody;
    }

    const body = responseBody as ExceptionBody;
    if (typeof body.message === 'string') {
      return body.message;
    }

    if (status === HttpStatus.FORBIDDEN) {
      return '无权限';
    }

    if (status === HttpStatus.UNAUTHORIZED) {
      return '未登录';
    }

    return fallback || '服务端错误';
  }

  private isPrismaKnownRequestError(exception: unknown): exception is PrismaKnownError {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      typeof (exception as { code?: unknown }).code === 'string'
    );
  }
}
