import { useEffect, useState } from 'react';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function BackNavStateLoss() {
  const [open, setOpen] = useState(false);

  // fixed: Back closes the modal (restoring this view) instead of exiting the route
  useEffect(() => {
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openModal = () => { setOpen(true); history.pushState({ modal: true }, '', '#modal'); };
  const closeModal = () => { setOpen(false); if (location.hash === '#modal') history.back(); };

  return (
    <ScenarioLayout slug="future/back-nav-state-loss">
      <div className="panel">
        <h2>Modal with correct back</h2>
        <p className="summary">Open the modal, then press Back. The Back button closes the modal and restores this view rather than exiting.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={openModal}>Open modal</button>
        </div>
        {open && (
          <div className="out">
            modal open — press browser Back to close
            <div className="row" style={{ marginTop: 8 }}><button onClick={closeModal}>Close</button></div>
          </div>
        )}
      </div>
    </ScenarioLayout>
  );
}
