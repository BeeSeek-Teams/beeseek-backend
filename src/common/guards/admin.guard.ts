import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Administrator } from '../../entities/administrator.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if the user is an instance of Administrator OR has a role that is NOT CLIENT/AGENT
    const isAdminAccount = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);

    if (!isAdminAccount) {
      throw new ForbiddenException('Access denied. Administrative privileges required.');
    }

    const requiredRoles = this.reflector.get<string[]>(ROLES_KEY, context.getHandler());
    if (!requiredRoles) {
      return true;
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`Access denied. Requires one of the following roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
