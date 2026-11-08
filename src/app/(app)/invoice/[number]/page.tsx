import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentBusiness } from "@/lib/business/current";
import { CONTACT_EMAIL, OPERATOR, OPERATOR_RC } from "@/lib/legal/entity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

const usd = (m: number) => `$${(m / 100).toFixed(2)}`;

/**
 * One invoice, printable.
 *
 * WHY A PAGE AND NOT A PDF. A PDF needs a rendering library, a font bundle and
 * somewhere to store the file, and the thing a customer actually does with an
 * invoice is print it or save it as a PDF from the browser — which this
 * supports with no dependency at all. The day one has to be emailed
 * automatically is the day to add the library, and not before.
 *
 * NO VAT LINE. UBAHGRID SERVICE LTD is not registered with FIRS, and showing a
 * VAT amount or a registration number you do not hold is an offence rather
 * than a formatting choice. The column exists and stays null, so registering
 * later is a config change rather than a migration.
 *
 * Read through the CUSTOMER's client, so row-level security decides whether
 * this invoice is theirs. A guessed invoice number returns nothing.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const supabase = await createClient();

  const business = await currentBusiness<{ id: string; name: string }>(supabase, "id, name");
  if (!business) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "number, kind, amount_usd_minor, amount_local_minor, local_currency, description, issued_at",
    )
    .eq("number", number)
    .maybeSingle();
  if (!invoice) notFound();

  const issued = new Date(invoice.issued_at as string).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const localMinor = invoice.amount_local_minor as number | null;
  const localCcy = invoice.local_currency as string | null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="print:hidden">
        <Link href="/statement" className="text-sm text-accent hover:text-accent-bright">
          Back to statement
        </Link>
      </div>

      <div className="mt-4 rounded-card border border-line bg-surface-raised p-8 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="datalabel">invoice</div>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
              {invoice.number}
            </h1>
          </div>
          <div className="text-right text-sm text-ink-muted">
            <div className="text-ink">{OPERATOR}</div>
            <div>RC {OPERATOR_RC}</div>
            <div>Nigeria</div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="datalabel">billed to</div>
            <div className="mt-1 text-sm text-ink">{business.name}</div>
          </div>
          <div className="sm:text-right">
            <div className="datalabel">issued</div>
            <div className="mt-1 text-sm text-ink">{issued}</div>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="pb-2 font-normal text-ink-faint">Description</th>
              <th className="pb-2 text-right font-normal text-ink-faint">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-3 text-ink">{String(invoice.description)}</td>
              <td className="py-3 text-right font-mono text-ink">
                {usd(invoice.amount_usd_minor as number)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className="pt-3 text-ink">Total</td>
              <td className="pt-3 text-right font-mono text-base font-semibold text-ink">
                {usd(invoice.amount_usd_minor as number)}
              </td>
            </tr>
            {localMinor !== null && localCcy && localCcy !== "USD" && (
              <tr>
                <td className="pt-1 text-xs text-ink-faint">Charged in {localCcy}</td>
                <td className="pt-1 text-right font-mono text-xs text-ink-faint">
                  {(localMinor / 100).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {localCcy}
                </td>
              </tr>
            )}
          </tfoot>
        </table>

        {/*
          * NOT contactSentence(). That helper is written for the legal pages
          * and, with no contact address configured, it explains how to DELETE
          * your account -- which is a strange thing to read at the bottom of a
          * bill. Spotted by rendering an invoice rather than by reading the
          * code. A billing contact appears only once there is one to give.
          */}
        <p className="mt-8 text-xs leading-relaxed text-ink-faint">
          Paid in full; this invoice is also the receipt. Amounts are in US
          dollars, the currency this account is denominated in.
          {CONTACT_EMAIL ? ` Questions about this invoice: ${CONTACT_EMAIL}.` : ""}
        </p>
      </div>

      <div className="mt-4 print:hidden">
        <p className="text-xs text-ink-faint">
          Use your browser&apos;s print option to save this as a PDF.
        </p>
      </div>
    </div>
  );
}
