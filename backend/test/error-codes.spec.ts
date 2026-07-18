import { getErrorCode } from '../src/common/constants/error-codes';

describe('uniform error codes', () => {
  it('keeps storage availability and capacity failures distinct from internal errors', () => {
    expect(getErrorCode(503)).toBe(50301);
    expect(getErrorCode(507)).toBe(50701);
    expect(getErrorCode(599)).toBe(50001);
  });
});
