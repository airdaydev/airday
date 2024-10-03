export const ListColumnHeaders = () => {
  return (
    <div style={"padding: 0 0.5em; color: var(--body-tint);"}>
      <span
        style={`width: 1rem;
        display: inline-flex;
        padding: 0 0.5em;
        height: 28px;
        align-items: center;`}
      >
        ✔
      </span>
      <span style={`display: inline-flex; width: 4em;`}>Date</span>
      <span>Az</span>
    </div>
  );
};
