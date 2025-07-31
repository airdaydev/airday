export interface TestResult {
  name: string;
  passed: boolean;
  expect: number;
  error?: string;
}

export interface TestSuite {
  results: TestResult[];
  passed: number;
  failed: number;
  total: number;
}

type Assert = (condition: boolean, message?: string) => void;

export class BrowserRunner {
  private tests: Array<{
    name: string;
    fn: (assert: Assert) => void | Promise<void>;
  }> = [];

  test(name: string, fn: (assert: Assert) => void | Promise<void>) {
    this.tests.push({ name, fn });
  }

  async run(): Promise<TestSuite> {
    const results: TestResult[] = [];

    for (const { name, fn } of this.tests) {
      let ctx = { expect: 0 };
      let assert = assertWrap(ctx);
      try {
        await fn(assert);
        results.push({ name, expect: ctx.expect, passed: true });
      } catch (error) {
        results.push({
          name,
          passed: false,
          expect: ctx.expect,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    return {
      results,
      passed,
      failed,
      total: results.length,
    };
  }

  clear() {
    this.tests = [];
  }
}

export function assertWrap(ctx: { expect: number }) {
  return (condition: boolean, message = "Assertion failed") => {
    if (!condition) {
      throw new Error(message);
    }
    ctx.expect++;
  };
}

export function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

export function assertDeepEqual<T>(actual: T, expected: T, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
