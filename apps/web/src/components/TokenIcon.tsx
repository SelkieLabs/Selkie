// Real token marks, kept local so they work offline and never hit a CDN.
// cETH (onRails) and Canton Coin (Canton Foundation) ship as the issuers' own
// brand logos, bundled as assets and clipped to a circle. cBTC carries
// BitSafe's angular B on their orange coin; USDC is the canonical mark. Every
// asset renders as the same circular coin at any size.
import cantonCoinLogo from "../assets/tokens/canton-coin.png";
import cethLogo from "../assets/tokens/ceth.png";

const CIRCLE = { cx: 16, cy: 16, r: 16 } as const;
const SHADOW = { boxShadow: "0 4px 12px -4px rgba(0,0,0,0.5)" } as const;

// Bundled brand logos, rendered as <img> and clipped to a circle.
const LOGO: Record<string, string> = {
  CC: cantonCoinLogo,
  CETH: cethLogo,
};

/** cBTC: BitSafe's orange coin carrying their angular B mark in white. */
function Cbtc() {
  return (
    <>
      <circle {...CIRCLE} fill="#F4652F" />
      <circle
        cx="16"
        cy="16"
        r="14.4"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.3"
        strokeWidth="1.1"
      />
      <g transform="translate(7.3 6.95) scale(0.5)" fill="#fff">
        <path d="M6.74898 0.598145H2.71986e-05V10.3442H6.74898V0.598145Z" />
        <path d="M2.71986e-05 35.5981H6.74898V25.8445H0L2.71986e-05 35.5981Z" />
        <path d="M28.4281 15.1836C32.0977 16.219 34.7734 19.5937 34.7734 23.6203C34.7734 28.4906 30.8363 32.4021 26.02 32.4021H17.7697V35.5981H11.0207V25.8445H24.7586C25.9818 25.8445 26.9756 24.8474 26.9756 23.6203C26.9756 22.3931 25.9818 21.3961 24.7586 21.3961H0V14.8001H18.7956C20.0188 14.8001 21.0126 13.803 21.0126 12.5759C21.0126 11.3487 20.0188 10.3516 18.7956 10.3516L17.7697 10.3442H11.0207V0.598145H17.7697V3.79403H20.057C24.8733 3.79403 28.8104 7.74394 28.8104 12.5759C28.8104 13.4962 28.6575 14.3783 28.4281 15.1836Z" />
      </g>
    </>
  );
}

function Usdc() {
  return (
    <>
      <circle {...CIRCLE} fill="#2775CA" />
      <g fill="#fff">
        <path d="M20.022 18.124c0-2.124-1.28-2.852-3.84-3.156-1.828-.243-2.193-.728-2.193-1.578 0-.85.61-1.396 1.828-1.396 1.097 0 1.707.364 2.011 1.275a.458.458 0 0 0 .427.303h.975a.416.416 0 0 0 .427-.425v-.06a3.04 3.04 0 0 0-2.743-2.489V9.142c0-.243-.183-.425-.487-.486h-.915c-.243 0-.426.182-.487.486v1.396c-1.829.242-2.986 1.456-2.986 2.974 0 2.002 1.218 2.791 3.778 3.095 1.707.303 2.255.668 2.255 1.639 0 .97-.853 1.638-2.011 1.638-1.585 0-2.133-.667-2.316-1.578-.06-.242-.244-.364-.427-.364h-1.036a.416.416 0 0 0-.426.425v.06c.243 1.518 1.219 2.61 3.23 2.914v1.457c0 .242.183.425.487.485h.915c.243 0 .426-.182.487-.485V21.34c1.829-.303 3.047-1.578 3.047-3.216z" />
        <path d="M12.892 24.497c-4.754-1.7-7.192-6.98-5.424-11.653.914-2.55 2.925-4.491 5.424-5.402.244-.121.365-.303.365-.607v-.85c0-.242-.121-.424-.365-.485-.061 0-.183 0-.244.06a10.895 10.895 0 0 0-7.13 13.717c1.096 3.4 3.717 6.01 7.13 7.102.244.121.488 0 .548-.243.061-.06.061-.122.061-.243v-.85c0-.182-.182-.424-.365-.546zm6.46-18.936c-.244-.122-.488 0-.548.242-.061.061-.061.122-.061.243v.85c0 .243.182.485.365.607 4.754 1.699 7.192 6.98 5.424 11.652-.914 2.55-2.925 4.492-5.424 5.402-.244.122-.365.304-.365.607v.85c0 .243.121.425.365.486.06 0 .182 0 .243-.061a10.895 10.895 0 0 0 7.13-13.716c-1.096-3.46-3.778-6.07-7.13-7.162z" />
      </g>
    </>
  );
}

const SVG_TOKENS: Record<string, () => React.ReactNode> = {
  CBTC: Cbtc,
  USDCX: Usdc,
};

export function TokenIcon({ asset, size = 32 }: { asset: string; size?: number }) {
  const logo = LOGO[asset];
  if (logo) {
    return (
      <img
        src={logo}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="shrink-0 rounded-full object-cover"
        style={SHADOW}
      />
    );
  }

  const Body = SVG_TOKENS[asset];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={SHADOW}
    >
      {Body ? (
        <Body />
      ) : (
        <>
          <circle {...CIRCLE} fill="#3a3547" />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
            fontSize="14"
            fontWeight="700"
            fill="#f4f1ea"
          >
            {asset.slice(0, 1)}
          </text>
        </>
      )}
    </svg>
  );
}
