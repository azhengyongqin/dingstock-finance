import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { URLSearchParams } from 'node:url';
import { Buffer } from 'node:buffer';
import { sm2, sm4 } from 'sm-crypto';
import axios, { AxiosError } from 'axios';
import { AppConfig } from '../config/app-config.type';
import { CmbRequestDto } from './dto/cmb-request.dto';

// CMB 国密网关返回中解析出来的通用对象。
type CmbJsonPayload = Record<string, any>;

export interface CmbAccountCredentials {
  uid: string;
  privateKey: string;
  publicKey: string;
  symKey: string;
}

interface CmbCryptoContext {
  uid: string;
  userId: string;
  privateKey: string;
  publicKey: string;
  symKey: string;
  iv: string;
}

@Injectable()
export class CmbApiService {
  private readonly logger = new Logger(CmbApiService.name);
  private readonly baseUrl: string;
  private readonly alg = 'SM';
  private readonly defaultCredentials: CmbAccountCredentials;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    // 读取配置：网关地址与密钥信息全部放在配置文件，不再硬编码在业务代码里。
    const cmb = this.configService.get('cmb', { infer: true });
    if (!cmb) {
      throw new Error('cmb 配置缺失');
    }

    this.baseUrl = cmb.baseUrl;
    this.defaultCredentials = {
      uid: cmb.uid,
      privateKey: cmb.privateKey,
      publicKey: cmb.publicKey,
      symKey: cmb.symKey,
    };
    this.timeoutMs = cmb.timeoutMs;
  }

  /**
   * 对齐原始示例的 sendRequest 能力：对 requestBody 签名加密 -> POST -> 解密 -> 校验签名。
   */
  async sendRequest(dto: CmbRequestDto): Promise<CmbJsonPayload> {
    return this.sendRequestWithCredentials(dto, this.defaultCredentials);
  }

  /**
   * 使用指定网银账户密钥发送请求；定时同步会按账户切换 UID/SM2/SM4 密钥。
   */
  async sendRequestWithCredentials(
    dto: CmbRequestDto,
    credentials: CmbAccountCredentials,
  ): Promise<CmbJsonPayload> {
    const normalizedDto = this.normalizePayload(dto);
    const body = this.extractRequestBody(normalizedDto);
    if (!body || typeof body !== 'object') {
      throw new HttpException(
        'body 必须是对象（请确认入参里有 body 字段，并且不是空字符串）',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Object.keys(body).length) {
      throw new HttpException('body 不能为空', HttpStatus.BAD_REQUEST);
    }

    const now = new Date();
    const reqDatetime = this.formatDateTime(now);
    const reqid = this.buildReqId(now);
    const context = this.buildCryptoContext(credentials);
    // 自动生成网关请求头参数，前端只传业务体/头部必要字段即可。
    const requestBody = this.recursiveArraySort({
      request: {
        body,
        head: {
          funcode: normalizedDto.head?.funcode,
          userid: (normalizedDto.head?.userid ?? context.uid).trim(),
          reqid: normalizedDto.head?.reqid ?? reqid,
        },
      },
      signature: {
        sigdat: '__signature_sigdat__',
        sigtim: reqDatetime,
      },
    }) as CmbJsonPayload;

    const funcode = requestBody.request?.head?.funcode;
    if (!funcode || typeof funcode !== 'string') {
      throw new HttpException(
        'head.funcode 不能为空，请在请求体 head.funcode 中传入',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 先对完整请求报文做签名。
    const requestJson = this.recursiveArraySort(requestBody);

    // 先按规范签名，签名填回到签名字段。
    const signature = sm2.doSignature(
      JSON.stringify(requestJson),
      context.privateKey,
      { hash: true, userId: context.userId },
    );
    requestJson.signature = {
      ...(requestJson.signature as object),
      sigdat: Buffer.from(signature, 'hex').toString('base64'),
    };

    // 加密请求报文并提交，保持 CDC 接口要求的 form-urlencoded 协议。
    const encryptedRequest = this.encryptPayload(requestJson, context);

    // 加密请求报文并提交，保持 CDC 接口要求的 form-urlencoded 协议。
    const encryptedResponse = await this.httpPost(
      encryptedRequest,
      funcode,
      context.uid,
    );

    // 响应解密并校验签名。
    const responseJson = this.decryptAndVerifyResponse(
      encryptedResponse,
      context,
    );
    return responseJson;
  }

  private buildCryptoContext(
    credentials: CmbAccountCredentials,
  ): CmbCryptoContext {
    const userId = credentials.uid.padEnd(16, '0');
    return {
      uid: credentials.uid,
      userId,
      privateKey: Buffer.from(credentials.privateKey, 'base64').toString('hex'),
      publicKey: Buffer.from(credentials.publicKey, 'base64').toString('hex'),
      symKey: Buffer.from(credentials.symKey).toString('hex'),
      iv: Buffer.from(userId, 'ascii').toString('hex'),
    };
  }

  /**
   * 兼容不同请求形态：body, request.body, 或 requestBody 场景下提取业务 body。
   */
  private normalizePayload(
    dto: CmbRequestDto | string,
  ): CmbRequestDto & { requestBody?: unknown; request?: { body?: unknown } } {
    if (typeof dto === 'string') {
      try {
        return JSON.parse(dto) as CmbRequestDto & {
          requestBody?: unknown;
          request?: { body?: unknown };
        };
      } catch {
        return {} as CmbRequestDto & {
          requestBody?: unknown;
          request?: { body?: unknown };
        };
      }
    }
    return dto;
  }

  private extractRequestBody(
    dto: CmbRequestDto & {
      requestBody?: unknown;
      request?: { body?: unknown };
    },
  ): Record<string, unknown> {
    const raw = (dto as { body?: unknown }).body;
    const requestBody = (dto as { requestBody?: unknown }).requestBody;
    const nested = (dto as { request?: { body?: unknown } }).request?.body;

    const candidates = [raw, nested, requestBody];
    for (const item of candidates) {
      if (!item) {
        continue;
      }
      if (typeof item === 'string') {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, unknown>;
          }
        } catch {
          continue;
        }
      }
      if (typeof item === 'object') {
        return item as Record<string, unknown>;
      }
    }
    return {};
  }

  private parseJson(payload: string): CmbJsonPayload {
    try {
      return JSON.parse(payload) as CmbJsonPayload;
    } catch (error) {
      throw new HttpException(
        `响应报文解析失败: ${error instanceof Error ? error.message : '未知错误'}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private encryptPayload(
    requestJson: CmbJsonPayload,
    context: CmbCryptoContext,
  ): string {
    const requestText = JSON.stringify(requestJson);
    const encrypted = sm4.encrypt(requestText, context.symKey, {
      iv: context.iv,
      mode: 'cbc',
      output: 'array',
    }) as unknown as number[];

    return Buffer.from(encrypted).toString('base64');
  }

  private decryptAndVerifyResponse(
    encryptedResponse: string,
    context: CmbCryptoContext,
  ): CmbJsonPayload {
    const decryptHex = sm4.decrypt(
      Buffer.from(encryptedResponse, 'base64').toString('hex'),
      context.symKey,
      { iv: context.iv, mode: 'cbc' },
    );
    const responseJson = this.parseJson(decryptHex);

    // 校验响应签名：按签名规则把 sigdat 置为固定占位符后再比对。
    const responseSig = responseJson['signature'];
    if (
      typeof responseSig !== 'object' ||
      responseSig === null ||
      !('sigdat' in responseSig)
    ) {
      throw new HttpException('响应报文签名字段缺失', HttpStatus.BAD_REQUEST);
    }
    const signatureHex = Buffer.from(
      `${responseSig['sigdat']}`,
      'base64',
    ).toString('hex');

    // 将响应报文按 key 排序，保持签名时字段顺序一致。
    const verifyTarget = this.recursiveArraySort(responseJson);
    verifyTarget.signature = {
      ...verifyTarget.signature,
      sigdat: '__signature_sigdat__',
    };
    const verifyText = JSON.stringify(verifyTarget);

    // 验证响应报文签名。
    const verify = sm2.doVerifySignature(
      verifyText,
      signatureHex,
      context.publicKey,
      { hash: true, userId: context.userId },
    );
    if (!verify) {
      throw new HttpException('响应报文签名无效', HttpStatus.UNAUTHORIZED);
    }

    return responseJson;
  }

  private async httpPost(
    data: string,
    funcode: string,
    uid: string,
  ): Promise<string> {
    const postData = new URLSearchParams({
      UID: uid,
      FUNCODE: funcode,
      ALG: this.alg,
      DATA: data,
    });
    try {
      const response = await axios.post(this.baseUrl, postData.toString(), {
        timeout: this.timeoutMs,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.toString().length,
        },
      });

      const responseText = JSON.stringify(response.data);
      if (responseText.startsWith('CDCServer:')) {
        throw new HttpException(
          `访问目标地址 ${this.baseUrl} 失败: ${responseText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return responseText;
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new HttpException(
          `HTTP 请求失败: ${error.response?.status} ${error.message}`,
          error.response?.status ?? HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }

  /** 生成网关报文级时间字符串，格式 yyyyMMddHHmmss。 */
  private formatDateTime(now: Date = new Date()): string {
    const full =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    return full;
  }

  /** 生成 reqid：yyyyMMddHHmmss + 毫秒 + 7位随机数。 */
  private buildReqId(now: Date = new Date()): string {
    const currentDatetime = this.formatDateTime(now);
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const random = String(Math.floor(Math.random() * 9000000) + 1000000);
    return `${currentDatetime}${milliseconds}${random}`;
  }

  /**
   * 递归按 key 排序，保持签名时字段顺序一致。
   */
  private recursiveArraySort<T>(input: T): T {
    if (input === null || typeof input !== 'object') {
      return input;
    }
    if (Array.isArray(input)) {
      return (input as unknown[]).map((item) =>
        this.recursiveArraySort(item),
      ) as T;
    }
    const sorted: Record<string, unknown> = {};
    const source = input as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      sorted[key] = this.recursiveArraySort(source[key]);
    }
    return sorted as T;
  }
}
