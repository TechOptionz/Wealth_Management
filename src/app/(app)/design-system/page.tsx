import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { Grid, Stack, Sub } from '@/shared/components/Layout';
import { DESKTOP_WIREFRAME, MOBILE_WIREFRAME, PALETTE, UI_RULES } from '@/modules/design-system/tokens';

export const metadata: Metadata = { title: 'Design system · Holdfast' };

/** Living reference for the palette, type scale, UI rules and layout. */
export default function DesignSystemPage() {
  return (
    <Stack>
      <Card>
        <CardHeader
          title="Palette"
          aside={
            <Sub>
              After analytica.live: near-black #08090a canvas, charcoal cards with hairline borders, orange #f77d00 accent; status
              colours always paired with an icon and label
            </Sub>
          }
        />
        <CardBody className="swatches">
          {PALETTE.map((swatch) => (
            <div className="sw" key={swatch.name}>
              <i
                style={{
                  background: swatch.hex,
                  ...(swatch.needsBorder ? { borderBottom: '1px solid var(--line)' } : {}),
                }}
              />
              <div>
                <b>{swatch.name}</b>
                {swatch.hex} · {swatch.usage}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Grid columns={2}>
        <Card>
          <CardHeader title="Type" aside={<Sub>IBM Plex Sans · tabular numerals on every figure</Sub>} />
          <CardBody>
            <div className="type-row">
              <small>KPI value · 28/600</small>
              <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>
                $4,821,300
              </span>
            </div>
            <div className="type-row">
              <small>Page title · 17/600</small>
              <span style={{ fontSize: 17, fontWeight: 600 }}>Obligations &amp; reminders</span>
            </div>
            <div className="type-row">
              <small>Card title · 14/600</small>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Cash flow · last 6 months</span>
            </div>
            <div className="type-row">
              <small>Body · 14/400</small>
              <span>Payment evidence closes an obligation; a sent reminder does not.</span>
            </div>
            <div className="type-row">
              <small>Table · 13/400</small>
              <span style={{ fontSize: 13 }}>166 Compton Rd · Room 3</span>
            </div>
            <div className="type-row">
              <small>Meta · 12/400 muted</small>
              <span className="sub" style={{ fontSize: 12 }}>
                Bank val · 18 Aug 2026 · confidence high
              </span>
            </div>
            <div className="type-row" style={{ border: 0 }}>
              <small>Chip · 11.5/500</small>
              <Chip tone="bad" icon="i-alert">
                Overdue 9 days
              </Chip>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rules the UI follows" />
          <CardBody>
            {UI_RULES.map((rule) => (
              <p className="ds-note" key={rule.title}>
                <b>{rule.title}</b> {rule.body}
              </p>
            ))}
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Layout & navigation" aside={<Sub>Desktop ≥ 841px · Mobile ≤ 840px</Sub>} />
        <CardBody className="frames">
          <pre className="wire">{DESKTOP_WIREFRAME}</pre>
          <pre className="wire">{MOBILE_WIREFRAME}</pre>
        </CardBody>
      </Card>
    </Stack>
  );
}
