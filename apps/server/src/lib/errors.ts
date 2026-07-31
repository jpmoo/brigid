export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "not authenticated") => new HttpError(401, m);
export const forbidden = (m: string) => new HttpError(403, m);
export const notFound = (m: string) => new HttpError(404, `${m} not found`);
export const conflict = (m: string) => new HttpError(409, m);
