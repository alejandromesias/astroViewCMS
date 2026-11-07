import { useState } from "react";

export interface Plan {
  title: string;
  subtitle?: string;
  price: number;
  price_yearly?: number;
  type: string;
  recommended?: boolean;
  features: string[];
  button: { label: string; link: string };
}

// Pricing cards with a monthly/yearly switch. Hydrated on the client
// (`client:visible`), so the switch works without a page reload. Plans without
// a `price_yearly` keep their monthly price in both modes.
export default function PricingPlans({ plans }: { plans: Plan[] }) {
  const [yearly, setYearly] = useState(false);

  return (
    <div>
      <div
        className="pricing-toggle mt-6 flex justify-center gap-2"
        role="group"
        aria-label="Billing period"
      >
        <button
          type="button"
          className={`btn ${yearly ? "btn-outline-primary" : "btn-primary"}`}
          aria-pressed={!yearly}
          onClick={() => setYearly(false)}
        >
          Monthly
        </button>
        <button
          type="button"
          className={`btn ${yearly ? "btn-primary" : "btn-outline-primary"}`}
          aria-pressed={yearly}
          onClick={() => setYearly(true)}
        >
          Yearly
        </button>
      </div>
      <div className="section row -mt-10 justify-center md:mt-0">
        {plans.map((plan) => {
          const showYearly = yearly && plan.price_yearly !== undefined;
          return (
            <div
              key={plan.title}
              className={`col-12 md:col-4 ${
                !plan.recommended ? "lg:px-0" : "col-recommended"
              }`}
            >
              <div className="card text-center">
                <h4>{plan.title}</h4>
                <div className="mt-5">
                  <span className="text-5xl text-text-dark">
                    ${showYearly ? plan.price_yearly : plan.price}
                  </span>
                  <span>/ {showYearly ? "year" : plan.type}</span>
                </div>
                <h6 className="mt-2 font-normal text-text">{plan.subtitle}</h6>
                <ul className="mt-5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="mb-[10px] leading-5">
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  className={`btn mt-5 ${
                    plan.recommended ? "btn-primary" : "btn-outline-primary"
                  }`}
                  href={plan.button.link}
                >
                  {plan.button.label}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
