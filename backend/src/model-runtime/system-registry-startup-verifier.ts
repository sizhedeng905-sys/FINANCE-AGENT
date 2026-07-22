import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { verifySystemRegistry } from './system-registry-bootstrap';
import { resolveSystemRegistryConfiguration } from './system-registry-manifest';

@Injectable()
export class SystemRegistryStartupVerifier implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemRegistryStartupVerifier.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const configuration = resolveSystemRegistryConfiguration(process.env);
    if (configuration.startupMode === 'disabled') return;

    const result = await verifySystemRegistry(this.prisma, configuration.manifest);
    this.logger.log(JSON.stringify({
      type: 'system_registry_verified',
      profile: result.profile,
      manifestSha256: result.manifestSha256,
      promptCount: result.promptCount,
      deploymentCount: result.deploymentCount,
      routeCount: result.routeCount,
      enabledDeploymentCount: result.enabledDeploymentCount,
      enabledRouteCount: result.enabledRouteCount
    }));
  }
}
