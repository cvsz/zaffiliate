import { useRouteError } from 'react-router-dom';

export default function ErrorBoundary() {
  const error = useRouteError();
  console.error(error);

  return (
    <div className="panel">
      <h3>Something went wrong</h3>
      <p className="error">
        {error instanceof Error ? error.message : 'Unknown error'}
      </p>
      <button className="btn" onClick={() => window.history.back()}>
        Go back
      </button>
    </div>
  );
}
