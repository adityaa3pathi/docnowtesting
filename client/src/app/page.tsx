"use client";
import { useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Button, Card, Input } from '@/components/ui';
import { LocationSelector } from '@/components/LocationSelector';
import {
  Search,
  ShoppingCart,
  ArrowRight,
  Activity,
  Heart,
  FileText,
  Award,
  Clock,
  Shield,
  Users,
  MessageCircle,
  Phone,
  Beaker
} from 'lucide-react';
import Slider from 'react-slick';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';
import Image from 'next/image';

export default function Home() {
  const [searchTerm, setSearchTerm] = useState('');

  const bannerSettings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 4000,
    arrows: false,
  };

  const promotionalBanners = [
    {
      id: 1,
      title: 'Get 30% OFF on First Booking!',
      description: 'Use code FIRST30 at checkout',
      bgColor: 'from-primary to-primary/80',
    },
    {
      id: 2,
      title: 'Free Home Sample Collection',
      description: 'Book now and get free sample pickup',
      bgColor: 'from-blue-600 to-blue-800',
    }
  ];

  const packages = [
    {
      id: 1,
      name: 'Basic Health Checkup',
      price: 999,
      tests: 15,
      description: 'Essential health screening package',
      icon: Activity,
    },
    {
      id: 2,
      name: 'Comprehensive Panel',
      price: 2499,
      tests: 45,
      description: 'Complete body health analysis',
      icon: Heart,
    },
    {
      id: 3,
      name: 'Senior Citizen Package',
      price: 2999,
      tests: 50,
      description: 'Comprehensive elderly care checkup',
      icon: Heart,
    }
  ];

  const tests = [
    { id: 101, name: 'Complete Blood Count (CBC)', price: 299, category: 'Blood Test' },
    { id: 102, name: 'Lipid Profile', price: 699, category: 'Blood Test' },
    { id: 103, name: 'Thyroid Function Test', price: 549, category: 'Hormone Test' }
  ];

  const whyChooseUs = [
    { icon: Award, title: 'Certified Labs', description: 'NABL & CAP certified laboratory' },
    { icon: Clock, title: 'Fast Reports', description: 'Get reports within 24-48 hours' },
    { icon: Shield, title: 'Data Privacy', description: '100% secure and confidential' },
    { icon: Users, title: 'Expert Team', description: 'Experienced healthcare professionals' }
  ];

  return (
    <main className="flex flex-col min-h-screen">
      <Header />


      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 text-white py-12 md:py-20">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 items-center">
            <div className="text-center lg:text-left">
              <h1 className="mb-6 text-4xl md:text-5xl lg:text-7xl font-black text-white leading-tight">
                Your Health, <br />
                <span className="text-white/80 italic">Our Priority</span>
              </h1>
              <p className="mb-10 text-lg md:text-xl text-white/90 font-medium max-w-xl mx-auto lg:mx-0">
                Book lab tests and health checkup packages from the comfort of your home.
                Fast, reliable, and affordable diagnostic services.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row justify-center lg:justify-start">
                <Button size="lg" className="bg-white text-primary hover:bg-gray-100 px-10">
                  Book Now
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10">
                  Learn More
                </Button>
              </div>
            </div>
            <div className="hidden lg:block relative h-[500px]">
              <div className="absolute inset-0 bg-white/10 blur-3xl rounded-full"></div>
              {/* Image Placeholder or actual Image if available */}
              <div className="relative z-10 w-full h-full bg-white/20 rounded-3xl border border-white/20 backdrop-blur-sm shadow-2xl overflow-hidden flex items-center justify-center">
                <Users className="w-32 h-32 text-white/20" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Serviceability Check (Integrating existing logic) */}
      <section className="py-12 bg-white -mt-10 relative z-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <LocationSelector />
          </div>
        </div>
      </section>

      {/* Top Health Packages Grid */}
      <section className="py-12 md:py-20 bg-white">
        <div className="container mx-auto px-4 max-w-7xl text-center">
          <div className="mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">
              Top Health Packages
            </h2>
            <p className="text-lg text-muted-foreground font-medium">
              Comprehensive health checkup packages tailored for your needs
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((pkg) => (
              <Card key={pkg.id} className="p-8 hover:shadow-xl hover:shadow-primary/5 transition-all group border-border/50">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent group-hover:bg-primary/10 transition-colors mx-auto">
                  <pkg.icon className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-3 text-2xl font-black text-foreground">
                  {pkg.name}
                </h3>
                <p className="mb-6 text-muted-foreground font-medium">{pkg.description}</p>
                <div className="mb-6 flex items-center justify-center gap-2">
                  <span className="text-sm text-muted-foreground font-bold">Includes {pkg.tests} tests</span>
                </div>
                <div className="mb-8 font-black text-4xl text-primary">
                  ₹{pkg.price}
                </div>
                <Button className="w-full py-6 text-lg">
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Add to Cart
                </Button>
              </Card>
            ))}
          </div>

          <div className="mt-12">
            <Button variant="outline" size="lg" className="border-primary/20 text-primary">
              View All Packages <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Available Individual Tests */}
      <section className="py-12 md:py-20 bg-accent/30">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">
              Available Lab Tests
            </h2>
            <p className="text-lg text-muted-foreground font-medium">
              Browse our comprehensive range of individual lab tests
            </p>
          </div>

          {/* Search Bar */}
          <div className="mb-12 mx-auto max-w-2xl">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                type="text"
                placeholder="Search for tests like Vitamin D, Thyroid..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 py-8 text-lg shadow-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {tests.map((test) => (
              <Card key={test.id} className="p-6 bg-white border-none shadow-sm hover:shadow-md transition-all">
                <div className="flex justify-between items-start mb-4">
                  <span className="bg-primary/5 text-primary text-[10px] font-black tracking-widest uppercase px-3 py-1 rounded-full">
                    {test.category}
                  </span>
                  <Beaker className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <h3 className="font-bold text-lg mb-6">{test.name}</h3>
                <div className="flex items-center justify-between">
                  <div className="text-2xl font-black text-primary">₹{test.price}</div>
                  <Button size="sm">Add</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-12 md:py-20 bg-white">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">Why Choose Us?</h2>
          </div>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 text-center">
            {whyChooseUs.map((feature, index) => (
              <div key={index} className="flex flex-col items-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent">
                  <feature.icon className="h-10 w-10 text-primary" />
                </div>
                <h3 className="mb-3 text-xl font-bold">{feature.title}</h3>
                <p className="text-muted-foreground font-medium">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Callback Section */}
      <section className="py-12 md:py-20 bg-white border-t border-border">
        <div className="container mx-auto px-4 max-w-3xl">
          <Card className="p-10 border-2 border-primary/10 shadow-xl text-center">
            <Phone className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl font-black mb-4">Need Help?</h2>
            <p className="text-muted-foreground font-medium mb-10">
              Request a callback and our medical team will reach out to you within 15 minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Input placeholder="Your Name" />
              <Input placeholder="Mobile Number" />
            </div>
            <Button size="lg" className="w-full mt-6 py-8 text-xl">
              Request Callback
            </Button>
          </Card>
        </div>
      </section>

      <Footer />
    </main>
  );
}
