import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { Request, Response } from 'express';

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
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const { status, code, message, data } = this.normalizeException(exception);

    if (status >= 500) {
      this.logger.error(JSON.stringify({
        type: 'http_exception',
        requestId: request.requestId,
        method: request.method,
        path: (request.originalUrl || request.url).split('?')[0],
        statusCode: status,
        exception: exception instanceof Error ? exception.name : 'UnknownException'
      }));
    }

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

    if (this.isPrismaKnownRequestError(exception) && exception.code === 'P2003') {
      return {
        status: HttpStatus.CONFLICT,
        code: getErrorCode(HttpStatus.CONFLICT),
        message: '资源仍被其他数据引用',
        data: {
          field: exception.meta?.field_name
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
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return '文件大小超过上传限制';
    }

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
