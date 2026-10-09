// CLEARLY SYNTHETIC demo data. All people, projects and contact details are invented.
// Dates are relative to "today" so the demo always looks current.
const iso = (base, plusDays) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + plusDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function demoItems(now = new Date()) {
  return [
    { kind: 'task', title: 'Send Project Atlas status update to stakeholders', due: iso(now, 1),
      body: 'Cover: beta onboarding finished for 3 of 4 pilot teams; search latency fix shipped; open risk is the vendor SSO delay.' },
    { kind: 'task', title: 'Review Maya\'s pull request for the CSV export bug', due: iso(now, 0),
      body: 'Small change, but it touches the export queue. Check the retry behaviour.' },
    { kind: 'task', title: 'Book a room for the Atlas retro', due: iso(now, 5), body: 'Needs space for 8 people and a screen.' },
    { kind: 'task', title: 'Renew the demo domain', due: iso(now, 10), body: 'Low priority; auto-renew is off.' },
    { kind: 'note', title: 'Atlas pilot notes',
      body: 'Pilot teams like the new dashboard. Two teams asked for CSV export. The SSO vendor promised a fix in about two weeks but has slipped once before.' },
    { kind: 'note', title: 'Standup takeaways',
      body: 'Latency fix verified in staging. Maya is out Monday. Decision: freeze beta scope next Friday.' },
    { kind: 'message', from: 'Priya Raman', title: 'Atlas status?',
      body: 'Hi! Quick one: can you share where Atlas stands ahead of Monday\'s sync? Mostly curious about pilot feedback and anything blocking us.\n\nThanks,\nPriya\npriya.raman@example.com | +1 (555) 010-0142' },
    { kind: 'message', from: 'Sam Ortiz', title: 'Lunch Thursday?',
      body: 'Are you free Thursday around 12:30? The new noodle place opened near the office.' }
  ].map((i) => ({ done: false, due: null, from: null, ...i, origin: 'demo' }));
}
