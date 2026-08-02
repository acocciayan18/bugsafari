import { useState } from 'react';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function BackNavStateLoss() {
  const [open, setOpen] = useState(false);

  const openModal = () => { setOpen(true); history.pushState({ modal: true }, '', '#modal'); };

  return (
    <ScenarioLayout slug="future/back-nav-state-loss">
      <div className="banner warn">
        Documented in BUG_TYPES.md; not detected by the current engine — BrokenNavigationFinder has no back-navigation hook.
      </div>
      <div className="panel">
        <h2>Modal with broken back</h2>
        <p className="summary">Open the modal, then press the browser Back button — it exits to / instead of restoring this list.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={openModal}>Open modal</button>
        </div>
        {open && <div className="out">modal open — press browser Back</div>}
      </div>
    </ScenarioLayout>
  );
}
