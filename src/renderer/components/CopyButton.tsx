import { useState, useCallback } from 'react';
import { CopyIcon, CheckIcon } from './Icons';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      className={`
        p-1.5 rounded-md transition-colors
        ${copied
          ? 'text-green-500'
          : 'text-content-tertiary hover:text-content-secondary hover:bg-chrome-subtle/60'
        }
        ${className}
      `}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}
