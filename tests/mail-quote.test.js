// @vitest-environment happy-dom
// Splitting a reply into what was written vs what was carried along.
// Uses a real DOM because parsing nested blockquotes with regex does not survive
// contact with actual mail.
import { describe, it, expect } from 'vitest';
import { splitQuotedHtml, splitQuotedText, countQuotedReplies } from '../src/lib/mail-quote.js';

describe('splitQuotedHtml', () => {
  it('keeps the new text and folds away a Gmail quote', () => {
    const html = `<div dir="ltr">Apologies — the notes only need the second floor.</div>
      <div class="gmail_quote">
        <div dir="ltr">On Wed, Jul 29, 2026 at 9:41 AM Ray wrote:</div>
        <blockquote>Awesome — happy to help.</blockquote>
      </div>`;
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain('only need the second floor');
    expect(visible).not.toContain('happy to help');
    expect(quoted).toContain('happy to help');
  });

  it('folds an Apple Mail cite blockquote', () => {
    const { visible, quoted } = splitQuotedHtml(
      '<p>Confirmed, thanks.</p><blockquote type="cite"><p>Can you confirm?</p></blockquote>',
    );
    expect(visible).toContain('Confirmed, thanks.');
    expect(visible).not.toContain('Can you confirm?');
    expect(quoted).toContain('Can you confirm?');
  });

  it('treats an Outlook boundary and everything after it as quoted', () => {
    const html = '<div>See attached.</div><div id="appendonsend"></div>'
      + '<div>From: Someone</div><div>Older body text</div>';
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain('See attached.');
    expect(visible).not.toContain('Older body text');
    expect(quoted).toContain('Older body text');
  });

  it('counts a nested quote once, not twice', () => {
    const html = '<p>New</p><div class="gmail_quote"><blockquote type="cite">Old</blockquote></div>';
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain('New');
    // "Old" must appear exactly once in the quoted output.
    expect(quoted.match(/Old/g)).toHaveLength(1);
  });

  it('folds a signature block', () => {
    const html = '<div>Thanks!</div><div class="gmail_signature">Ray Arocha · RM117 · 201-555-0100</div>';
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain('Thanks!');
    expect(visible).not.toContain('201-555-0100');
    expect(quoted).toContain('201-555-0100');
  });

  it('leaves an ordinary message completely alone', () => {
    const html = '<div dir="ltr"><p>Good morning Tom, please confirm the underpin detail.</p></div>';
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain('underpin detail');
    expect(quoted).toBe('');
  });

  it('never drops content — visible + quoted retain both halves', () => {
    const html = '<p>AAA</p><div class="gmail_quote"><p>BBB</p></div>';
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible + quoted).toContain('AAA');
    expect(visible + quoted).toContain('BBB');
  });

  it('handles empty input', () => {
    expect(splitQuotedHtml('')).toEqual({ visible: '', quoted: '' });
    expect(splitQuotedHtml(null)).toEqual({ visible: '', quoted: '' });
  });
});

describe('splitQuotedText', () => {
  it('cuts at "On … wrote:"', () => {
    const { visible, quoted } = splitQuotedText(
      'Sounds good.\n\nOn Wed, Jul 29, 2026 at 9:41 AM Ray <ray@rm117.com> wrote:\n> earlier note',
    );
    expect(visible).toBe('Sounds good.');
    expect(quoted).toContain('earlier note');
  });

  it('cuts at a run of > lines', () => {
    const { visible, quoted } = splitQuotedText('Yes please.\n\n> the old message\n> more old');
    expect(visible).toBe('Yes please.');
    expect(quoted).toContain('the old message');
  });

  it('cuts at the -- signature convention', () => {
    const { visible, quoted } = splitQuotedText('Confirmed.\n\n-- \nRay Arocha\nRM117');
    expect(visible).toBe('Confirmed.');
    expect(quoted).toContain('Ray Arocha');
  });

  it('cuts at an Outlook original-message rule', () => {
    const { visible } = splitQuotedText('Approved.\n\n-----Original Message-----\nFrom: someone');
    expect(visible).toBe('Approved.');
  });

  it('takes the EARLIEST marker when several are present', () => {
    const { visible } = splitQuotedText('Short reply.\n\n> quoted\n\nOn Mon someone wrote:\n> more');
    expect(visible).toBe('Short reply.');
  });

  it('leaves an unquoted message alone', () => {
    const { visible, quoted } = splitQuotedText('Please send the survey when you get a chance.');
    expect(visible).toBe('Please send the survey when you get a chance.');
    expect(quoted).toBe('');
  });

  it('does not cut a message that merely mentions the word wrote', () => {
    const { quoted } = splitQuotedText('I wrote the letter yesterday and mailed it.');
    expect(quoted).toBe('');
  });

  it('never returns empty visible text for a message that starts quoted', () => {
    // A top-posted-nothing reply: keep it whole rather than showing a blank bubble.
    const { visible } = splitQuotedText('> only quoted content here');
    expect(visible).toContain('only quoted content');
  });
});

describe('countQuotedReplies', () => {
  it('counts quote openers', () => {
    expect(countQuotedReplies('On Mon X wrote:\nblah\nOn Tue Y wrote:\nblah')).toBe(2);
  });
  it('reports zero for nothing quoted', () => {
    expect(countQuotedReplies('')).toBe(0);
  });
  it('reports at least one when there is quoted content it cannot parse', () => {
    expect(countQuotedReplies('<div>some quoted markup</div>')).toBe(1);
  });
});
