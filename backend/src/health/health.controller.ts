import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: {
          status: 'ok'
        }
      }
    }
  })
  check() {
    return {
      status: 'ok'
    };
  }
}
