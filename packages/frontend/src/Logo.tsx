export function Logo({ caption = 'FLORAL STUDIO' }: { caption?: string }) {
  return <a className="wordmark" href="/" aria-label="Gulnara home">
    <img className="logo-mark" src="/gulnara-logo.svg" alt="" width={48} height={54} aria-hidden/>
    <span className="brand-name">gulnara<small>{caption}</small></span>
  </a>;
}
