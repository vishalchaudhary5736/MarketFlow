import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC } from './public.decorator';
import { TOKEN_TYPE_KEY, TokenType } from './two.factor.decorator';

@Injectable()
export class AuthGaurd implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split(' ')[1] ?? null;
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: any;

    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch (error) {
      console.log('request->>>>>>>>', error);
      throw new UnauthorizedException();
    }

    const requiredType =
      this.reflector.getAllAndOverride<TokenType>(TOKEN_TYPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'access';

    const tokenType: TokenType = payload.purpose ?? 'access';
    if (tokenType !== requiredType) {
      throw new UnauthorizedException('Invalid token for this route');
    }

    request['user'] = payload;

    return true;
  }
}
