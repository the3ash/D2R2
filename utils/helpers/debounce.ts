/**
 * Standard debounce implementation
 * @param func The function to debounce
 * @param wait Wait time in milliseconds
 * @param immediate Execute immediately on the leading edge
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>): void {
    const context = this;

    const later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);

    if (callNow) {
      func.apply(context, args);
    }
  };
}

/**
 * Standard throttle implementation
 * @param func The function to throttle
 * @param limit Minimum time between executions in milliseconds
 * @param options Additional options
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
  options: { leading?: boolean; trailing?: boolean } = {
    leading: true,
    trailing: true,
  }
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeout: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  let context: any = null;

  const { leading = true, trailing = true } = options;

  return function (this: any, ...args: Parameters<T>): void {
    const now = Date.now();

    context = this;
    lastArgs = args;

    if (!lastCall && !leading) {
      lastCall = now;
    }

    const remaining = limit - (now - lastCall);

    if (remaining <= 0 || remaining > limit) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      lastCall = now;
      func.apply(context, args);
    } else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        lastCall = leading ? Date.now() : 0;
        timeout = null;
        func.apply(context, lastArgs!);
      }, remaining);
    }
  };
}

/**
 * Create a function that can be called at most once
 * @param func The function to restrict
 */
export function once<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  let called = false;
  let result: ReturnType<T> | undefined;

  return function (
    this: any,
    ...args: Parameters<T>
  ): ReturnType<T> | undefined {
    if (!called) {
      called = true;
      result = func.apply(this, args);
    }
    return result;
  };
}
