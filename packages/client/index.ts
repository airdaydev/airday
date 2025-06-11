export class AirdayClient {
  root = new URL("http://localhost:3000");
  constructor(rootURL: string) {
    this.root = new URL(rootURL);
  }
  getAPIRoot() {
    return fetch(this.root)
      .then((response) => response.json())
      .then((data) => {
        return data;
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  }
}
