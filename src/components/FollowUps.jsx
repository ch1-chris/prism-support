export default function FollowUps({ questions, onSelect }) {
  if (!questions?.length) return null;

  return (
    <div className="followups">
      {questions.map((q, i) => (
        <button key={i} className="followup-pill" onClick={() => onSelect(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
