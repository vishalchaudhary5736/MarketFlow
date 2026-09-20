import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
    private readonly sessionTTL = 7*24*60*60; // 7 days in seconds
   constructor(
    @Inject(CACHE_MANAGER) private readonly cacheService: Cache,
  ) {}

  async cacheSession({sessionId,userId,token,refreshToken,userAgent}:{userAgent:string,sessionId:string,userId:string,token:string,refreshToken:string}){
    const session = {
        sessionId:sessionId,
        userId:userId,
        tokenHash:token,
        refreshTokenHash:refreshToken,
        userAgent:userAgent,
        createdAt:new Date().toISOString(),
    }
    await this.cacheService.set(`session:${userId}`,session,this.sessionTTL)
  }

  async getSession(userId:string){
    return await this.cacheService.get(`session:${userId}`)
  }
}
