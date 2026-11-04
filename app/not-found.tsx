export const metadata = { title: "Not found · Undo" };

export default function NotFound() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Undo</p>
        <h1>That page doesn&apos;t exist</h1>
        <p className="muted">
          Try <a href="/">the store</a>, <a href="/judge">judge mode</a> or <a href="/evals">the measured results</a>.
        </p>
      </header>
    </main>
  );
}
