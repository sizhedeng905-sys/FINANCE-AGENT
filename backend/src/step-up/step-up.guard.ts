import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthenticatedRequest } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { STEP_UP_REQUIREMENT_KEY, StepUpRequirement } from './require-step-up.decorator';
import { StepUpEnforcementService } from './step-up-enforcement.service';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpEnforcementService
  ) {}

  async canActivate(context: ExecutionContext) {
    const requirement = this.reflector.getAllAndOverride<StepUpRequirement>(STEP_UP_REQUIREMENT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!requirement || !this.stepUp.requires(requirement.action)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const body = request.body as Record<string, unknown> | undefined;
    if (
      requirement.whenBodyFieldPresent &&
      !Object.prototype.hasOwnProperty.call(body ?? {}, requirement.whenBodyFieldPresent)
    ) return true;

    const resourceId = this.resolveResourceId(request, requirement);
    const rawToken = request.headers['x-step-up-token'];
    const token = Array.isArray(rawToken) ? undefined : rawToken;
    await this.stepUp.consume(
      token,
      request.user,
      requirement.action,
      requirement.resourceType,
      resourceId,
      getRequestContext(request)
    );
    return true;
  }

  private resolveResourceId(request: AuthenticatedRequest, requirement: StepUpRequirement) {
    if (requirement.staticResourceId) return requirement.staticResourceId;
    if (requirement.resourceParam) {
      const value = request.params?.[requirement.resourceParam];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    if (requirement.resourceBodyFields?.length) {
      const body = request.body as Record<string, unknown> | undefined;
      const values = requirement.resourceBodyFields.map((field) => body?.[field]);
      if (values.every((value) => typeof value === 'string' && value.length > 0)) {
        return values.join(':');
      }
    }
    throw new UnauthorizedException('STEP_UP_RESOURCE_BINDING_UNAVAILABLE');
  }
}
