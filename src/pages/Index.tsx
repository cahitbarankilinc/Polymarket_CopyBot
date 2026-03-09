import { useState } from 'react';
import { DashboardProvider } from '@/context/DashboardContext';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import AddAddressTab from '@/components/dashboard/AddAddressTab';
import RealTradeTab from '@/components/dashboard/RealTradeTab';

const Index = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <DashboardProvider>
      <div className="min-h-screen bg-background">
        <DashboardHeader activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <section className={activeTab === 0 ? '' : 'hidden'}>
            <AddAddressTab />
          </section>
          <section className={activeTab === 1 ? '' : 'hidden'}>
            <RealTradeTab />
          </section>
        </main>
      </div>
    </DashboardProvider>
  );
};

export default Index;
