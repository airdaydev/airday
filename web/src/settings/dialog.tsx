// Synced vs non synced
// Non synced = local storage / idb saved
// Synced = local storage / idb / backed up

// Personalisation
// Advanced
// --
// Account
// - (email, password, security, tokens, keys)
// - Sessions
// Workspace (Limit 2 synced per paid user) - flow for adding a second?
// Billing

export const Settings = () => (
  <div>
    <h1>Settings</h1>
    <nav>
      <section>
        <div>Personalisation</div>
        <div>Language</div>
      </section>
      <section>
        <div>Security</div>
        <div>Sessions</div>
        <div>Workspace</div>
        <div>Billing</div>
      </section>
    </nav>
  </div>
);
