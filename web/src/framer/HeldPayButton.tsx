// Held "Pay with Held" button for Framer: https://getheld.xyz
// Add it in Framer: Assets > Code > + > New code file, name it HeldPayButton, replace everything with this file,
// save, then drag "HeldPayButton" onto the canvas. Set your checkout link in the panel on the right.
import { addPropertyControls, ControlType, RenderTarget } from "framer"
import { useEffect, useState, type CSSProperties } from "react"

const DEFAULT_LINK = ""

interface Props {
    link?: string
    label?: string
    theme?: "dark" | "light"
    tagline?: boolean
    newTab?: boolean
    radius?: number
    style?: CSSProperties
}

interface LinkInfo {
    item: string
    amount: string
    active: boolean
}

const LIME = "#D5F94F"
const THEMES = {
    dark: { background: "#0b0d10", color: "#fff", border: LIME, accent: LIME },
    light: { background: "#fff", color: "#0b0d10", border: "#0b0d10", accent: "#4d5a00" },
}

// "https://getheld.xyz/#/buy/Ab3xYz" -> the site it lives on and the link id. Anything else is not a checkout link.
function parse(link: string): { origin: string; id: string } | null {
    try {
        const url = new URL(link.trim())
        const m = url.hash.match(/^#\/buy\/([A-Za-z0-9_-]+)$/)
        return m && url.protocol === "https:" ? { origin: url.origin, id: m[1] } : null
    } catch {
        return null
    }
}

// Prices are stored in base units (6 decimals).
const usd = (base: string) =>
    (Number(base) / 1e6).toLocaleString("en-US", { style: "currency", currency: "USD" })

/**
 * @framerSupportedLayoutWidth auto
 * @framerSupportedLayoutHeight auto
 */
export default function HeldPayButton(props: Props) {
    const { link = DEFAULT_LINK, label = "", theme = "dark", tagline = true, newTab = true, radius = 10, style } = props
    const target = parse(link)
    const [info, setInfo] = useState<LinkInfo | null>(null)
    const [missing, setMissing] = useState(false)
    const onCanvas = RenderTarget.current() === RenderTarget.canvas

    useEffect(() => {
        setInfo(null)
        setMissing(false)
        if (!target) return
        let live = true
        fetch(`${target.origin}/api/links/${target.id}`)
            .then((r) => {
                if (r.status === 404) {
                    if (live) setMissing(true)
                    return null
                }
                return r.ok ? r.json() : null
            })
            .then((l: LinkInfo | null) => {
                if (live && l) setInfo(l)
            })
            .catch(() => {}) // offline or blocked: the button still opens the link, and Held's page says the rest
        return () => {
            live = false
        }
    }, [target?.origin, target?.id])

    // No usable link yet: a hint while editing, nothing on the published site.
    if (!target) {
        if (!onCanvas) return null
        return (
            <div style={{ ...hint, borderRadius: radius, ...style }}>
                {link.trim()
                    ? "That isn't a Held checkout link. Copy one from your Held dashboard (Checkout links)."
                    : "Held: paste your checkout link in the panel on the right."}
            </div>
        )
    }

    const c = THEMES[theme] ?? THEMES.dark
    const off = missing || info?.active === false
    const text = off
        ? "No longer available"
        : label.trim() || (info ? `Pay ${usd(info.amount)} with Held` : "Pay with Held")

    const box: CSSProperties = {
        position: "relative",
        minWidth: "max-content",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 20px",
        borderRadius: radius,
        background: c.background,
        border: `1px solid ${c.border}`,
        color: c.color,
        font: "600 15px/1.2 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        textDecoration: "none",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        cursor: off ? "default" : "pointer",
        opacity: off ? 0.5 : 1,
        ...style,
    }
    const content = (
        <>
            <img
                src={`${target.origin}/held-favicon.png`}
                width={20}
                height={20}
                alt=""
                style={{ display: "block" }}
            />
            {text}
            {tagline && !off && (
                <span style={{ fontWeight: 400, fontSize: 12, color: c.accent }}>buyer protected</span>
            )}
        </>
    )

    if (off) {
        return (
            <div style={box} title={onCanvas ? "This checkout link is turned off or removed in your Held dashboard." : undefined}>
                {content}
            </div>
        )
    }
    return (
        <a
            href={`${target.origin}/#/buy/${target.id}`}
            target={newTab ? "_blank" : "_self"}
            rel="noopener"
            style={box}
            title={info ? `${info.item}, paid through Held: your payment is protected until you confirm delivery.` : undefined}
        >
            {content}
        </a>
    )
}

const hint: CSSProperties = {
    position: "relative",
    padding: "12px 16px",
    border: "1px dashed #8a8f98",
    color: "#8a8f98",
    font: "13px/1.4 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    maxWidth: 320,
}

addPropertyControls(HeldPayButton, {
    link: {
        type: ControlType.String,
        title: "Checkout link",
        placeholder: "https://getheld.xyz/#/buy/…",
        defaultValue: DEFAULT_LINK,
    },
    label: {
        type: ControlType.String,
        title: "Label",
        placeholder: "Pay $25 with Held (automatic)",
        defaultValue: "",
    },
    theme: {
        type: ControlType.Enum,
        title: "Theme",
        options: ["dark", "light"],
        optionTitles: ["Dark", "Light"],
        displaySegmentedControl: true,
        defaultValue: "dark",
    },
    tagline: {
        type: ControlType.Boolean,
        title: "Tagline",
        enabledTitle: "Show",
        disabledTitle: "Hide",
        defaultValue: true,
    },
    newTab: {
        type: ControlType.Boolean,
        title: "Open in",
        enabledTitle: "New tab",
        disabledTitle: "Same tab",
        defaultValue: true,
    },
    radius: {
        type: ControlType.Number,
        title: "Radius",
        min: 0,
        max: 30,
        unit: "px",
        defaultValue: 10,
    },
})
