export interface TestResult {
  name: string;
  passed: boolean;
  assertions: number;
  error?: string;
}

export interface TestSuite {
  results: TestResult[];
  skipped: number;
  passed: number;
  failed: number;
  total: number;
}

type Assert = (condition: boolean, message?: string) => void;

export class BrowserRunner {
  skipped = 0;
  private tests: Array<{
    name: string;
    only?: boolean;
    fn: (assert: Assert) => void | Promise<void>;
  }> = [];

  test(name: string, fn: (assert: Assert) => void | Promise<void>) {
    this.tests.push({ name, fn });
  }

  skip(name: string, fn: (assert: Assert) => void | Promise<void>) {
    log(`skipping test ${name}`);
    this.skipped++;
  }

  only(name: string, fn: (assert: Assert) => void | Promise<void>) {
    this.tests.push({ name, fn, only: true });
  }

  async run(): Promise<TestSuite> {
    const results: TestResult[] = [];

    const only = this.tests.filter((test) => test.only);
    let tests = this.tests;
    if (only.length > 0) {
      tests = only;
      this.skipped = only.length;
    }

    console.log(`Running ${this.tests.length} tests`);

    for (const { name, fn } of tests) {
      console.log(`running test: ${name}`, fn);
      let ctx = { assertions: 0 };
      let assert = assertWrap(ctx);
      try {
        await fn(assert);
        results.push({ name, assertions: ctx.assertions, passed: true });
      } catch (error) {
        results.push({
          name,
          passed: false,
          assertions: ctx.assertions,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    return {
      results,
      skipped: this.skipped,
      passed,
      failed,
      total: results.length,
    };
  }

  clear() {
    this.tests = [];
  }
}

export function assertWrap(ctx: { assertions: number }) {
  return (condition: boolean, message = "Assertion failed") => {
    if (!condition) {
      throw new Error(message);
    }
    ctx.assertions++;
  };
}

export function log(value: any) {
  const elapsed = performance.now() / 1000;
  let serialised = null;
  try {
    serialised = JSON.stringify(value);
  } catch (err) {}
  const msg = `${elapsed}s: ${serialised}`;
  console.log(msg);
}
