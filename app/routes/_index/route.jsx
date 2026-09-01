import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function LandingPage() {
  const { showForm } = useLoaderData();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        backgroundColor: "#F9FAFB",
        color: "#222222",
      }}
    >
      {/* Hero Section */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px 40px",
          textAlign: "center",
        }}
      >
        {/* Rocket Icon */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            backgroundColor: "#4A5568",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            marginBottom: 24,
          }}
        >
          🚀
        </div>

        {/* Main Heading */}
        <h1
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: "#222222",
            margin: "0 0 12px",
            lineHeight: 1.2,
          }}
        >
          PERFORMANCE APP
        </h1>

        {/* Subheading */}
        <p
          style={{
            fontSize: 18,
            color: "#4A5568",
            margin: "0 0 40px",
            maxWidth: 520,
            lineHeight: 1.6,
          }}
        >
          Enhance loading speed, improve user experience, and drive conversions
          with automated optimizations — without the expensive price tag.
        </p>

        {/* Login Form */}
        {showForm && (
          <Form
            method="post"
            action="/auth/login"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              width: "100%",
              maxWidth: 400,
            }}
          >
            <div
              style={{
                width: "100%",
                textAlign: "left",
              }}
            >
              <label
                htmlFor="shop"
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#333333",
                  marginBottom: 6,
                }}
              >
                Shop domain
              </label>
              <input
                id="shop"
                name="shop"
                type="text"
                placeholder="e.g. my-shop-domain.myshopify.com"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 15,
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "12px 24px",
                fontSize: 16,
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "#2B6CB0",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Get Started
            </button>
          </Form>
        )}
      </div>

      {/* Features Section */}
      <div
        style={{
          padding: "48px 24px",
          backgroundColor: "#FFFFFF",
          borderTop: "1px solid #E5E7EB",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 32,
          }}
        >
          {/* Feature 1 */}
          <div
            style={{
              padding: "28px 24px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              backgroundColor: "#F9FAFB",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: "#E8F8F0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                marginBottom: 16,
              }}
            >
              🔍
            </div>
            <h3
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "#222222",
                margin: "0 0 8px",
              }}
            >
              Automated Store Audit
            </h3>
            <p
              style={{
                fontSize: 14,
                color: "#4A5568",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              We automatically scan your Home, Collection, and Product pages to
              identify hidden performance bottlenecks, resource-heavy scripts,
              and off-screen elements.
            </p>
          </div>

          {/* Feature 2 */}
          <div
            style={{
              padding: "28px 24px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              backgroundColor: "#F9FAFB",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: "#EBF4FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                marginBottom: 16,
              }}
            >
              ⚡
            </div>
            <h3
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "#222222",
                margin: "0 0 8px",
              }}
            >
              Intelligent Script Deferral
            </h3>
            <p
              style={{
                fontSize: 14,
                color: "#4A5568",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Delay the loading of non-critical third-party scripts until actual
              user interaction. We hide off-screen sections via CSS to ensure a
              lightning-fast first paint.
            </p>
          </div>

          {/* Feature 3 */}
          <div
            style={{
              padding: "28px 24px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              backgroundColor: "#F9FAFB",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: "#FEF3C7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                marginBottom: 16,
              }}
            >
              🎛️
            </div>
            <h3
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "#222222",
                margin: "0 0 8px",
              }}
            >
              Complete Optimization Control
            </h3>
            <p
              style={{
                fontSize: 14,
                color: "#4A5568",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Review your automated audit results at any time. Easily add custom
              script names or CSS selectors by hand to continuously fine-tune
              your performance.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "32px 24px",
          backgroundColor: "#FFFFFF",
          borderTop: "1px solid #E5E7EB",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: "#4A5568",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            🚀
          </div>
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#4A5568",
              letterSpacing: 1,
            }}
          >
            PERFORMANCE APP
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#718096",
            textTransform: "uppercase",
            letterSpacing: 1.5,
          }}
        >
          Boost Your Store Performance
        </span>
        <span
          role="link"
          tabIndex={0}
          onClick={() => {}}
          onKeyDown={() => {}}
          style={{
            fontSize: 12,
            color: "#2B6CB0",
            textDecoration: "none",
            marginTop: 4,
            cursor: "pointer",
          }}
        >
          Terms of use
        </span>
      </div>
    </div>
  );
}
