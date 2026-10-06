import { describe, expect, it } from 'vitest';
import { AudioPreviewRecovery } from './audioPreviewRecovery';
describe('recovery ownership and limits', () => {
  it('deduplicates work and invalidates late callbacks on cancellation', () => {
    const c=new AudioPreviewRecovery();const token=c.begin(0)!;
    expect(c.begin(1)).toBeNull();expect(c.valid(token)).toBe(true);
    c.cancel();expect(c.valid(token)).toBe(false);
  });
  it('permits two recovery rounds per minute and requires manual retry after failure', () => {
    const c=new AudioPreviewRecovery();const a=c.begin(0)!;c.finish(a);
    const b=c.begin(10000)!;c.finish(b);
    expect(c.begin(20000)).toBeNull();expect(c.blocked).toBe(true);
    c.retry();expect(c.begin(20001)).not.toBeNull();
  });
  it('keeps the budget across cancellation and forgets old successful rounds', () => {
    const c=new AudioPreviewRecovery();c.begin(0);c.cancel();const a=c.begin(10000)!;c.finish(a);
    expect(c.begin(61001)).not.toBeNull();
  });
  it('does not let a stale finish release another operation', () => {
    const c=new AudioPreviewRecovery();const old=c.begin(0)!;c.cancel();const current=c.begin(10000)!;
    c.finish(old);expect(c.valid(current)).toBe(true);c.fail(current);expect(c.blocked).toBe(true);
  });
});
