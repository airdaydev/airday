import test from "tape";

export const tests = async () => {
  await new Promise((resolve) => {
    test(async (t) => {
      console.log("does it work");
      t.pass();
    });
    test.onFinish(() => {
      console.log("finished");
      resolve();
    });
  });
};
