export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface TestSuite {
  results: TestResult[];
  passed: number;
  failed: number;
  total: number;
}

export class SimpleTest {
  private tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

  test(name: string, fn: () => void | Promise<void>) {
    this.tests.push({ name, fn });
  }

  async run(): Promise<TestSuite> {
    const results: TestResult[] = [];

    for (const { name, fn } of this.tests) {
      try {
        console.log("ATTEMPING!", name);
        await fn();
        console.log("FAILED!!", name);
        results.push({ name, passed: true });
      } catch (error) {
        console.log("ERROR!", error);
        results.push({
          name,
          passed: false,
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

// Simple assertion helpers
export function assert(condition: boolean, message = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
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
