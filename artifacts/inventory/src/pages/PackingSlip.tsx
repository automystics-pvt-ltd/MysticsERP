import { useParams } from "wouter";
import { useGetSalesOrder, getGetSalesOrderQueryKey } from "@/lib/queryKeys";
import { formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect } from "react";

export default function PackingSlip() {
  const { id } = useParams();
  const orderId = parseInt(id || "0", 10);

  const { data: orderDetail, isLoading } = useGetSalesOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetSalesOrderQueryKey(orderId) },
  });

  useEffect(() => {
    if (!orderDetail) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [orderDetail]);

  if (isLoading || !orderDetail) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const { order, lines } = orderDetail;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #packing-slip, #packing-slip * { visibility: visible; }
          #packing-slip { position: fixed; inset: 0; padding: 2cm; }
        }
        @media screen {
          body { background: #f3f4f6; }
          #packing-slip-outer { display: flex; justify-content: center; padding: 2rem; min-height: 100vh; }
          #packing-slip { background: white; width: 21cm; min-height: 29.7cm; padding: 2cm; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        }
      `}</style>
      <div id="packing-slip-outer">
        <div id="packing-slip" className="font-sans text-sm text-gray-900">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Packing Slip</h1>
              <p className="text-gray-500 mt-1">Order {order.orderNumber}</p>
            </div>
            <div className="text-right text-sm text-gray-600">
              <p>Date: {formatDate(order.orderDate)}</p>
              {order.expectedShipDate && (
                <p>Ship By: {formatDate(order.expectedShipDate)}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ship To</h2>
              <p className="font-semibold">{order.walkinName || order.customerName}</p>
              {order.notes && (
                <p className="text-gray-600 whitespace-pre-line text-sm mt-1">{order.notes}</p>
              )}
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Order Info</h2>
              <table className="text-sm w-full">
                <tbody>
                  <tr>
                    <td className="text-gray-500 pr-4 py-0.5">Order #</td>
                    <td className="font-medium">{order.orderNumber}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-500 pr-4 py-0.5">Order Date</td>
                    <td>{formatDate(order.orderDate)}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-500 pr-4 py-0.5">Warehouse</td>
                    <td>{order.warehouseName}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <table className="w-full border-collapse mb-8" style={{ borderTop: "2px solid #e5e7eb" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th className="text-left py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Item</th>
                <th className="text-left py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-gray-500">SKU</th>
                <th className="text-right py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td className="py-3 pr-4 font-medium">{line.itemName}</td>
                  <td className="py-3 pr-4 text-gray-500 font-mono text-xs">{line.sku}</td>
                  <td className="py-3 text-right font-semibold">{Number(line.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                <td colSpan={2} className="py-3 pr-4 font-semibold text-gray-700">Total Items</td>
                <td className="py-3 text-right font-bold">{lines.reduce((s, l) => s + Number(l.quantity), 0)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1rem", marginTop: "auto" }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Notes</h2>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "4px", minHeight: "60px", padding: "0.5rem" }}></div>
          </div>

          <div className="mt-8 text-center text-xs text-gray-400">
            <p>Thank you for your order!</p>
          </div>
        </div>
      </div>
    </>
  );
}
