import { defineMessages } from '@farmplus/i18n';

/**
 * Dashboards (farm and admin, components/analytics): the API sends its labels in English; the view looks them up here.
 * - `metric.<definition key>`, `table.<section>.<table>`, `series.<name>`: by the API's keys.
 * - `col.*`, `note.*`, `reason.*`: found by their English text (the `en` value must stay exactly the API's text).
 * Anything not listed here is shown as the API sent it.
 */
export default defineMessages({
  th: {
    'metric.farm.animals.animalsOnFarm': 'สัตว์ที่กำลังเลี้ยง',
    'metric.farm.animals.totalRecorded': 'สัตว์ที่บันทึกไว้ทั้งหมด',
    'metric.farm.growth.weighingsInRange': 'จำนวนครั้งที่ชั่งน้ำหนัก',
    'metric.farm.growth.animalsWeighed': 'สัตว์ที่ชั่งน้ำหนักแล้ว',
    'metric.farm.growth.animalsWithGainEstimate': 'สัตว์ที่ประเมินอัตราโตได้',
    'metric.farm.growth.averageDailyGainG': 'อัตราโตเฉลี่ยต่อวัน',
    'metric.farm.growth.estimatedWeightShare': 'น้ำหนักที่เป็นค่าประมาณ',
    'metric.farm.health.healthRecordsInRange': 'บันทึกสุขภาพ',
    'metric.farm.health.illnessRecords': 'บันทึกการเจ็บป่วย',
    'metric.farm.health.treatmentRecords': 'บันทึกการรักษา',
    'metric.farm.health.vaccinationRecords': 'บันทึกการฉีดวัคซีน',
    'metric.farm.health.animalsWithIllnessOrTreatment': 'สัตว์ที่มีบันทึกเจ็บป่วยหรือรักษา',
    'metric.farm.health.withdrawalsRunning': 'สัตว์ที่อยู่ในระยะหยุดยา',
    'metric.farm.health.vaccinationsDueNext30Days': 'สัตว์ที่ถึงกำหนดวัคซีนใน 30 วัน',
    'metric.farm.feeding.feedingLogsInRange': 'บันทึกการให้อาหาร',
    'metric.farm.feeding.animalsFed': 'สัตว์ที่มีบันทึกการให้อาหาร',
    'metric.farm.feeding.groupFeedingLogs': 'บันทึกการให้อาหารแบบกลุ่ม',
    'metric.farm.costs.recordedCostMinor': 'ค่าใช้จ่ายที่บันทึกไว้',
    'metric.farm.costs.expenseRecords': 'รายการค่าใช้จ่าย',
    'metric.farm.costs.costAssignedToAnimalsMinor': 'ค่าใช้จ่ายที่ระบุสัตว์',
    'metric.farm.costs.farmWideCostMinor': 'ค่าใช้จ่ายรวมของฟาร์ม',
    'metric.farm.listings.activeListings': 'ประกาศขายสัตว์ที่เปิดอยู่',
    'metric.farm.listings.reservedListings': 'ประกาศที่ติดจอง',
    'metric.farm.listings.pendingReviewListings': 'ประกาศที่รอตรวจสอบ',
    'metric.farm.listings.listingsCreatedInRange': 'ประกาศที่สร้าง',
    'metric.farm.sales.ordersCreated': 'คำสั่งซื้อที่สร้าง',
    'metric.farm.sales.ordersPaid': 'คำสั่งซื้อที่ชำระแล้ว',
    'metric.farm.sales.grossSalesMinor': 'ยอดขายรวม',
    'metric.farm.sales.shippingCollectedMinor': 'ค่าจัดส่งที่เก็บได้',
    'metric.farm.sales.platformCommissionMinor': 'ค่าธรรมเนียมแพลตฟอร์ม',
    'metric.farm.sales.estimatedNetProceedsMinor': 'รายรับสุทธิโดยประมาณ',
    'metric.farm.sales.netProceedsReleasedMinor': 'รายรับสุทธิที่โอนแล้ว',
    'metric.farm.sales.netProceedsPendingMinor': 'รายรับสุทธิที่รอโอน',
    'metric.farm.sales.refundedGrossMinor': 'คืนเงินแล้วหรือกำลังคืน (ไม่นับรวม)',
    'metric.farm.sales.cancelledOrders': 'คำสั่งซื้อที่ยกเลิก',
    'metric.farm.sales.averageOrderValueMinor': 'มูลค่าเฉลี่ยต่อคำสั่งซื้อ',
    'metric.farm.sales.netProceedsOverRecordedCostMinor': 'รายรับสุทธิหักค่าใช้จ่ายที่บันทึก',
    'metric.farm.products.activeProducts': 'สินค้าที่เปิดขาย',
    'metric.farm.products.pendingReviewProducts': 'สินค้าที่รอตรวจสอบ',
    'metric.farm.products.outOfStockProducts': 'สินค้าที่หมดสต็อก',
    'metric.farm.products.lowStockProducts': 'สินค้าที่ใกล้หมด',
    'metric.farm.products.unitsSold': 'จำนวนสินค้าที่ขายได้',
    'metric.farm.products.productGrossSalesMinor': 'ยอดขายสินค้ารวม',
    'metric.farm.assessments.assessmentsInRange': 'การประเมินด้วย AI',
    'metric.farm.assessments.assessmentsPending': 'การประเมินที่รอคุณตรวจ',
    'metric.farm.assessments.assessmentsAccepted': 'การประเมินที่ตรวจแล้ว',
    'metric.farm.assessments.assessmentsDismissed': 'การประเมินที่ไม่ใช้',
    'metric.farm.assessments.withPriceRange': 'การประเมินที่มีช่วงราคา',
    'metric.farm.assessments.lowConfidence': 'การประเมินที่ความมั่นใจต่ำ',
    'metric.farm.assessments.highConfidence': 'การประเมินที่ความมั่นใจสูง',
    'metric.admin.users.totalUsers': 'ผู้ใช้ที่ลงทะเบียน',
    'metric.admin.users.newUsersInRange': 'ผู้ใช้ใหม่',
    'metric.admin.users.activeUsers': 'บัญชีที่ใช้งานอยู่',
    'metric.admin.users.suspendedUsers': 'บัญชีที่ถูกระงับ',
    'metric.admin.registrations.registrationsSubmitted': 'คำขอที่ส่งเข้ามา',
    'metric.admin.registrations.registrationsApproved': 'ในจำนวนนี้ อนุมัติแล้ว',
    'metric.admin.registrations.registrationsPendingNow': 'คำขอที่รออยู่ตอนนี้',
    'metric.admin.farms.activeFarms': 'ฟาร์มที่ใช้งานอยู่',
    'metric.admin.farms.newFarmsInRange': 'ฟาร์มใหม่',
    'metric.admin.farms.farmsWithSalesInRange': 'ฟาร์มที่มีคำสั่งซื้อชำระแล้ว',
    'metric.admin.listings.activeListings': 'ประกาศขายสัตว์ที่เปิดอยู่',
    'metric.admin.listings.activeProducts': 'สินค้าที่เปิดขาย',
    'metric.admin.listings.listingsCreatedInRange': 'ประกาศที่สร้าง',
    'metric.admin.orders.ordersCreated': 'คำสั่งซื้อที่สร้าง',
    'metric.admin.orders.ordersPaid': 'คำสั่งซื้อที่ชำระแล้ว',
    'metric.admin.orders.gmvMinor': 'มูลค่าสินค้ารวม (GMV)',
    'metric.admin.orders.shippingMinor': 'ค่าจัดส่งที่เรียกเก็บ',
    'metric.admin.orders.buyerPaidTotalMinor': 'ยอดที่ผู้ซื้อชำระทั้งหมด',
    'metric.admin.orders.cancelledOrders': 'คำสั่งซื้อที่ยกเลิก',
    'metric.admin.orders.refundedOrders': 'คืนเงินแล้วหรือกำลังคืน',
    'metric.admin.payments.paymentAttempts': 'ครั้งที่พยายามชำระเงิน',
    'metric.admin.payments.paymentsSucceeded': 'ชำระเงินสำเร็จ',
    'metric.admin.payments.paymentsFailed': 'ชำระเงินไม่สำเร็จ',
    'metric.admin.payments.paymentSuccessRate': 'อัตราการชำระเงินสำเร็จ',
    'metric.admin.payments.amountReceivedMinor': 'ยอดเงินที่ได้รับ',
    'metric.admin.payments.unappliedPayments': 'เงินที่ยังไม่ได้ผูกกับคำสั่งซื้อ',
    'metric.admin.commissions.commissionMinor': 'ค่าธรรมเนียมแพลตฟอร์ม',
    'metric.admin.commissions.commissionReleasedMinor': 'ค่าธรรมเนียมจากคำสั่งซื้อที่ส่งถึงแล้ว',
    'metric.admin.commissions.commissionInProgressMinor':
      'ค่าธรรมเนียมจากคำสั่งซื้อที่กำลังดำเนินการ',
    'metric.admin.commissions.commissionBookedNetMinor': 'ค่าธรรมเนียมที่บันทึกในบัญชี (สุทธิ)',
    'metric.admin.refunds.refundsRequested': 'คำขอคืนเงิน',
    'metric.admin.refunds.refundedMinor': 'ยอดที่คืนเงินแล้ว',
    'metric.admin.refunds.refundsOpenMinor': 'ยอดคืนเงินที่รออยู่',
    'metric.admin.refunds.refundsFailed': 'คืนเงินไม่สำเร็จ',
    'metric.admin.payouts.withdrawalsRequested': 'คำขอถอนเงิน',
    'metric.admin.payouts.paidOutMinor': 'ยอดที่โอนออกแล้ว',
    'metric.admin.payouts.payoutsPendingMinor': 'ยอดโอนที่รออยู่',
    'metric.admin.payouts.sellerBalancesMinor': 'ยอดค้างจ่ายผู้ขาย (ตามบัญชี)',
    'metric.admin.payouts.payoutsFailed': 'โอนเงินไม่สำเร็จ',
    'metric.admin.moderation.listingsPendingReview': 'ประกาศที่รอตรวจสอบ',
    'metric.admin.moderation.productsPendingReview': 'สินค้าที่รอตรวจสอบ',
    'metric.admin.moderation.openContentReports': 'รายงานเนื้อหาที่ยังเปิดอยู่',
    'metric.admin.moderation.oldestPendingHours': 'รอนานที่สุดในคิว',
    'metric.admin.alerts.alertCount': 'การแจ้งเตือนที่เปิดอยู่',
    'metric.admin.alerts.failedPaymentsLast24h': 'ชำระเงินไม่สำเร็จ (24 ชั่วโมงล่าสุด)',
    'table.animals.byTypeAndStatus': 'จำนวนสัตว์ตามชนิดและสถานะ',
    'table.growth.gainByAnimal': 'อัตราโตรายตัว',
    'table.health.byType': 'ตามประเภทบันทึก',
    'table.feeding.byCategory': 'ตามหมวดอาหาร',
    'table.costs.byCategory': 'ตามหมวดค่าใช้จ่าย',
    'table.listings.byStatus': 'ประกาศตามสถานะ',
    'table.sales.ordersByStatus': 'คำสั่งซื้อตามสถานะ',
    'table.sales.recentOrders': 'คำสั่งซื้อล่าสุด',
    'table.products.topProducts': 'สินค้าขายดี',
    'table.users.byStatus': 'บัญชีตามสถานะ',
    'table.registrations.byStatus': 'คำขอตามสถานะ',
    'table.listings.listingsByStatus': 'ประกาศตามสถานะ',
    'table.orders.ordersByStatus': 'คำสั่งซื้อตามสถานะ',
    'table.payments.byStatus': 'การชำระเงินตามสถานะ',
    'table.commissions.commissionByOrderType': 'ค่าธรรมเนียมตามประเภทคำสั่งซื้อ',
    'series.weighings': 'การชั่งน้ำหนัก',
    'series.healthRecords': 'บันทึกสุขภาพ',
    'series.feedingLogs': 'บันทึกการให้อาหาร',
    'series.recordedCosts': 'ค่าใช้จ่ายที่บันทึก',
    'series.grossSales': 'ยอดขายรวม',
    'series.netProceeds': 'รายรับสุทธิ',
    'series.newUsers': 'ผู้ใช้ใหม่',
    'series.submitted': 'คำขอที่ส่งเข้ามา',
    'series.newFarms': 'ฟาร์มใหม่',
    'series.gmv': 'มูลค่าสินค้ารวม (GMV)',
    'series.amountReceived': 'ยอดเงินที่ได้รับ',
    'col.animalType': 'ชนิดสัตว์',
    'col.total': 'รวม',
    'col.animal': 'สัตว์',
    'col.firstKg': 'น้ำหนักแรก (กก.)',
    'col.latestKg': 'น้ำหนักล่าสุด (กก.)',
    'col.days': 'จำนวนวัน',
    'col.adg': 'อัตราโตเฉลี่ยต่อวัน (ก./วัน)',
    'col.type': 'ประเภท',
    'col.records': 'จำนวนบันทึก',
    'col.feedCategory': 'หมวดอาหาร',
    'col.logs': 'จำนวนบันทึก',
    'col.category': 'หมวด',
    'col.amount': 'จำนวนเงิน',
    'col.status': 'สถานะ',
    'col.listings': 'ประกาศ',
    'col.ordersPlaced': 'คำสั่งซื้อที่สร้าง',
    'col.order': 'คำสั่งซื้อ',
    'col.placed': 'วันที่สั่ง',
    'col.items': 'จำนวนรายการ',
    'col.grossItems': 'ยอดขาย (สินค้า)',
    'col.platformFee': 'ค่าธรรมเนียมแพลตฟอร์ม',
    'col.netProceeds': 'รายรับสุทธิ',
    'col.product': 'สินค้า',
    'col.units': 'จำนวนชิ้น',
    'col.accounts': 'บัญชี',
    'col.statusNow': 'สถานะ (ตอนนี้)',
    'col.submittedInRange': 'ส่งเข้ามาในช่วงนี้',
    'col.payments': 'การชำระเงิน',
    'col.orderType': 'ประเภทคำสั่งซื้อ',
    'col.commission': 'ค่าธรรมเนียม',
    'value.orderKind.animal': 'สัตว์',
    'value.orderKind.product': 'สินค้า',
    'value.unknownType': 'ไม่ทราบชนิด',
    'note.healthNoDiagnosis': 'นับตามที่บันทึกไว้ FARM+ ไม่ได้ตีความบันทึกสุขภาพหรือวินิจฉัยโรค',
    'note.costsTypeFilter':
      'เมื่อกรองตามชนิดสัตว์ จะนับเฉพาะค่าใช้จ่ายที่ระบุสัตว์ชนิดนั้น ไม่รวมค่าใช้จ่ายของทั้งฟาร์ม',
    'note.salesStatusNow':
      'สถานะเป็นสถานะปัจจุบัน คำสั่งซื้อที่ชำระในช่วงนี้แล้วคืนเงินภายหลังจะไม่นับรวม',
    'note.netNotProfit':
      'รายรับสุทธิโดยประมาณยังไม่หักค่าจัดส่ง ค่าธรรมเนียมผู้ให้บริการ และภาษี และไม่ใช่กำไร',
    'note.salesNoTypeFilter': 'ตัวกรองชนิดสัตว์ไม่มีผลกับยอดขาย ตัวเลขนี้รวมทุกคำสั่งซื้อของฟาร์ม',
    'note.aiNotAdvice': 'การประเมินด้วย AI ใช้ช่วยตัดสินใจเท่านั้น ไม่ใช่คำแนะนำ',
    'note.gmvNotRevenue':
      'มูลค่าสินค้ารวมคือยอดที่ผู้ซื้อจ่ายค่าสินค้าและสัตว์ ไม่ใช่รายได้ของ FARM+ ซึ่งคือค่าธรรมเนียมแพลตฟอร์ม',
    'note.commissionNotProfit':
      'ค่าธรรมเนียมคือรายได้ของแพลตฟอร์มจากการขาย มูลค่าสินค้ารวมคือยอดที่ผู้ซื้อจ่ายให้ผู้ขาย ทั้งสองอย่างไม่ใช่กำไร',
    'note.ledgerBasis':
      'ตัวเลขในบัญชีนับตามวันที่ชำระ/คืนเงิน ตัวเลขคำสั่งซื้อนับตามวันที่ชำระและสถานะปัจจุบัน',
    'reason.farmAnimals': 'คุณไม่มีสิทธิ์ดูสัตว์ในฟาร์มนี้',
    'reason.farmRecords': 'คุณไม่มีสิทธิ์ดูบันทึกของฟาร์มนี้',
    'reason.farmExpenses': 'คุณไม่มีสิทธิ์ดูค่าใช้จ่ายของฟาร์มนี้',
    'reason.farmSelling': 'ข้อมูลการขายสำหรับเจ้าของและผู้จัดการฟาร์มเท่านั้น',
    'reason.adminUsers': 'ต้องมีสิทธิ์ดูข้อมูลผู้ใช้',
    'reason.adminRegistrations': 'ต้องมีสิทธิ์ตรวจสอบคำขอ',
    'reason.adminFarms': 'ต้องมีสิทธิ์ดูข้อมูลฟาร์ม',
    'reason.adminReports': 'ต้องมีสิทธิ์ดูรายงาน',
    'reason.adminPayments': 'ตัวเลขการเงินต้องมีสิทธิ์ด้านการชำระเงิน',
    'reason.adminModeration': 'ต้องมีสิทธิ์ด้านการตรวจสอบเนื้อหา',
    'reason.adminAlerts': 'การแจ้งเตือนด้านการเงินต้องมีสิทธิ์ด้านการชำระเงิน',
    'filter.animalType': 'ชนิดสัตว์',
    'filter.orderKind': 'ประเภทคำสั่งซื้อ',
    'def.admin.alerts.alertCount.definition':
      'จำนวนกฎการแจ้งเตือนที่กำลังแจ้งเตือนอยู่ตอนนี้ (ดูในรายการ)',
    'def.admin.alerts.alertCount.includes':
      'การแจ้งเตือนเรื่องการชำระเงิน การคืนเงิน และการโอนเงินให้ผู้ขาย',
    'def.admin.alerts.alertCount.excludes': 'ไม่มี',
    'def.admin.alerts.failedPaymentsLast24h.definition':
      'การชำระเงินที่แจ้งว่าล้มเหลวใน 24 ชั่วโมงที่ผ่านมา ไม่ขึ้นกับช่วงวันที่เลือก',
    'def.admin.alerts.failedPaymentsLast24h.includes': 'ตามที่อธิบายไว้',
    'def.admin.alerts.failedPaymentsLast24h.excludes': 'รายการอื่น',
    'def.admin.commissions.commissionBookedNetMinor.definition':
      'ยอดเคลื่อนไหวสุทธิของบัญชีแพลตฟอร์มในบัญชีแยกประเภทในช่วงวันที่เลือก คือค่าธรรมเนียมที่บันทึกรับตอนชำระเงิน หักค่าธรรมเนียมที่ถูกหักกลับจากการคืนเงิน โดยนับตามวันที่บันทึกบัญชี',
    'def.admin.commissions.commissionBookedNetMinor.includes':
      'รายการบันทึกบัญชีของการเรียกเก็บเงินและการคืนเงิน',
    'def.admin.commissions.commissionBookedNetMinor.excludes': 'ไม่มี',
    'def.admin.commissions.commissionBookedNetMinor.caveats':
      'จะเท่ากับค่าธรรมเนียมที่คิดตามคำสั่งซื้อ เมื่อการคืนเงินแต่ละรายการบันทึกบัญชีในช่วงวันที่เดียวกับการชำระเงิน ถ้าการคืนเงินบันทึกบัญชีในช่วงถัดไป จะไปลดตัวเลขของช่วงนั้นแทน',
    'def.admin.commissions.commissionInProgressMinor.definition':
      'ค่าธรรมเนียมจากคำสั่งซื้อที่ชำระแล้วแต่ยังไม่ส่งถึง (ยังอาจถูกหักกลับได้หากมีการคืนเงิน)',
    'def.admin.commissions.commissionInProgressMinor.includes': 'ตามที่อธิบายไว้',
    'def.admin.commissions.commissionInProgressMinor.excludes': 'คำสั่งซื้อที่ส่งถึงแล้ว',
    'def.admin.commissions.commissionMinor.definition':
      'ค่าธรรมเนียมที่ FARM+ เก็บจากคำสั่งซื้อที่ชำระแล้วและยังไม่ถูกยกเลิกหรือคืนเงิน (กำหนดตายตัวในแต่ละคำสั่งซื้อตอนสั่งซื้อ) นี่คือรายได้ของ FARM+ จากการขาย',
    'def.admin.commissions.commissionMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.commissions.commissionMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.admin.commissions.commissionMinor.caveats':
      'ยังไม่หักต้นทุนของ FARM+ เองและค่าธรรมเนียมผู้ให้บริการ จึงไม่ใช่กำไร',
    'def.admin.commissions.commissionReleasedMinor.definition':
      'ส่วนของค่าธรรมเนียมจากคำสั่งซื้อที่ส่งถึงแล้ว (จะไม่มีการคืนเงินตามมาอีก)',
    'def.admin.commissions.commissionReleasedMinor.includes':
      'คำสั่งซื้อที่ชำระแล้วและถึงสถานะส่งถึงแล้ว (DELIVERED)',
    'def.admin.commissions.commissionReleasedMinor.excludes': 'คำสั่งซื้อที่ยังดำเนินการอยู่',
    'def.admin.farms.activeFarms.definition': 'ฟาร์มที่ไม่ได้เก็บเข้าคลัง',
    'def.admin.farms.activeFarms.includes': 'ตามที่อธิบายไว้',
    'def.admin.farms.activeFarms.excludes': 'ฟาร์มที่เก็บเข้าคลัง',
    'def.admin.farms.farmsWithSalesInRange.definition':
      'จำนวนฟาร์ม (ไม่นับซ้ำ) ที่มีคำสั่งซื้อที่ชำระแล้วและยังไม่ถูกยกเลิกหรือคืนเงินอย่างน้อยหนึ่งรายการในช่วงวันที่เลือก',
    'def.admin.farms.farmsWithSalesInRange.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.farms.farmsWithSalesInRange.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.admin.farms.newFarmsInRange.definition': 'ฟาร์มที่สร้างในช่วงวันที่เลือก',
    'def.admin.farms.newFarmsInRange.includes': 'ทุกสถานะ',
    'def.admin.farms.newFarmsInRange.excludes': 'ไม่มี',
    'def.admin.listings.activeListings.definition':
      'ประกาศขายสัตว์ที่เปิดขายอยู่ตอนนี้ ทั้งแพลตฟอร์ม',
    'def.admin.listings.activeListings.includes': 'ทุกฟาร์ม',
    'def.admin.listings.activeListings.excludes': 'สถานะอื่น',
    'def.admin.listings.activeProducts.definition':
      'สินค้าในร้านค้าที่เปิดขายอยู่ตอนนี้ ทั้งแพลตฟอร์ม',
    'def.admin.listings.activeProducts.includes': 'ทุกฟาร์ม',
    'def.admin.listings.activeProducts.excludes': 'สถานะอื่น',
    'def.admin.listings.listingsCreatedInRange.definition':
      'ประกาศขายสัตว์ที่สร้างในช่วงวันที่เลือก',
    'def.admin.listings.listingsCreatedInRange.includes': 'ทุกสถานะ',
    'def.admin.listings.listingsCreatedInRange.excludes': 'ไม่มี',
    'def.admin.moderation.listingsPendingReview.definition': 'ประกาศขายสัตว์ที่รอผู้ดูแลตรวจสอบ',
    'def.admin.moderation.listingsPendingReview.includes': 'ทุกฟาร์ม',
    'def.admin.moderation.listingsPendingReview.excludes': 'สถานะอื่น',
    'def.admin.moderation.oldestPendingHours.definition':
      'ระยะเวลาที่รอของประกาศขายหรือสินค้าที่รอตรวจสอบนานที่สุด',
    'def.admin.moderation.oldestPendingHours.includes': 'ประกาศขายและสินค้าที่รอตรวจสอบ',
    'def.admin.moderation.oldestPendingHours.excludes': 'รายงานเนื้อหาและคำขอลงทะเบียน',
    'def.admin.moderation.openContentReports.definition':
      'รายงานเนื้อหาเกี่ยวกับโพสต์ ความคิดเห็น หรือวิดีโอ ที่ยังไม่ได้ดำเนินการหรือปิดทิ้ง',
    'def.admin.moderation.openContentReports.includes': 'ทั้งหมด',
    'def.admin.moderation.openContentReports.excludes': 'รายงานที่ปิดแล้ว',
    'def.admin.moderation.productsPendingReview.definition': 'สินค้าในร้านค้าที่รอผู้ดูแลตรวจสอบ',
    'def.admin.moderation.productsPendingReview.includes': 'ทุกฟาร์ม',
    'def.admin.moderation.productsPendingReview.excludes': 'สถานะอื่น',
    'def.admin.orders.buyerPaidTotalMinor.definition':
      'เงินทั้งหมดที่ผู้ซื้อจ่ายในคำสั่งซื้อเหล่านั้น คือค่าสินค้ารวมค่าจัดส่ง',
    'def.admin.orders.buyerPaidTotalMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.orders.buyerPaidTotalMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.admin.orders.cancelledOrders.definition':
      'คำสั่งซื้อที่สั่งในช่วงวันที่เลือกและถูกยกเลิกก่อนชำระเงิน',
    'def.admin.orders.cancelledOrders.includes': 'ตามที่อธิบายไว้',
    'def.admin.orders.cancelledOrders.excludes': 'คำสั่งซื้อที่คืนเงินแล้ว',
    'def.admin.orders.gmvMinor.definition':
      'ราคาสินค้าของคำสั่งซื้อที่ชำระแล้วและยังไม่ถูกยกเลิกหรือคืนเงิน ทั้งแพลตฟอร์ม (เงินที่ผู้ซื้อจ่ายค่าสินค้าและสัตว์) ไม่ใช่รายได้ของ FARM+',
    'def.admin.orders.gmvMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.orders.gmvMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว) และค่าจัดส่ง',
    'def.admin.orders.gmvMinor.caveats': 'รายได้ของแพลตฟอร์มคือค่าธรรมเนียมแพลตฟอร์มเท่านั้น',
    'def.admin.orders.ordersCreated.definition': 'คำสั่งซื้อที่สร้างในช่วงวันที่เลือก',
    'def.admin.orders.ordersCreated.includes': 'ทุกสถานะ',
    'def.admin.orders.ordersCreated.excludes': 'ไม่มี',
    'def.admin.orders.ordersPaid.definition':
      'คำสั่งซื้อที่ชำระในช่วงวันที่เลือก และยังไม่ถูกยกเลิกหรือคืนเงิน',
    'def.admin.orders.ordersPaid.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.orders.ordersPaid.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.admin.orders.refundedOrders.definition':
      'คำสั่งซื้อที่ชำระในช่วงวันที่เลือก และตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED)',
    'def.admin.orders.refundedOrders.includes': 'ตามที่อธิบายไว้',
    'def.admin.orders.refundedOrders.excludes': 'รายการอื่น',
    'def.admin.orders.shippingMinor.definition':
      'ค่าจัดส่งของคำสั่งซื้อเหล่านั้น (เป็นเงินที่ส่งต่อ ไม่ใช่รายได้)',
    'def.admin.orders.shippingMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.admin.orders.shippingMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.admin.payments.amountReceivedMinor.definition':
      'ยอดเงินที่ผู้ให้บริการแจ้งว่าเรียกเก็บได้ จากการชำระเงินที่สำเร็จซึ่งสร้างในช่วงวันที่เลือก',
    'def.admin.payments.amountReceivedMinor.includes': 'ตามที่อธิบายไว้',
    'def.admin.payments.amountReceivedMinor.excludes': 'รายการที่ล้มเหลวและรอดำเนินการ',
    'def.admin.payments.amountReceivedMinor.caveats':
      'รวมเงินที่คืนภายหลัง และเงินที่ยังไม่ได้นำไปใช้กับคำสั่งซื้อ',
    'def.admin.payments.paymentAttempts.definition': 'การชำระเงินที่เริ่มในช่วงวันที่เลือก',
    'def.admin.payments.paymentAttempts.includes': 'ทุกสถานะ',
    'def.admin.payments.paymentAttempts.excludes': 'ไม่มี',
    'def.admin.payments.paymentSuccessRate.definition':
      'สัดส่วนการชำระเงินที่สำเร็จ จากการชำระเงินที่มีผลสิ้นสุดแล้ว',
    'def.admin.payments.paymentSuccessRate.includes': 'การชำระเงินที่มีผลสุดท้ายแล้ว',
    'def.admin.payments.paymentSuccessRate.excludes':
      'การชำระเงินที่ยังรอดำเนินการ ยกเลิก และหมดอายุ (เป็นการทิ้งกลางคัน ไม่ใช่ถูกปฏิเสธ)',
    'def.admin.payments.paymentsFailed.definition':
      'จากรายการเหล่านั้น การชำระเงินที่ผู้ให้บริการแจ้งว่าล้มเหลว',
    'def.admin.payments.paymentsFailed.includes': 'ตามที่อธิบายไว้',
    'def.admin.payments.paymentsFailed.excludes': 'รายการอื่น',
    'def.admin.payments.paymentsSucceeded.definition':
      'จากรายการเหล่านั้น การชำระเงินที่ผู้ให้บริการยืนยันแล้ว',
    'def.admin.payments.paymentsSucceeded.includes':
      'การชำระเงินที่คืนเงินแล้วด้วย เพราะเคยชำระสำเร็จมาก่อน',
    'def.admin.payments.paymentsSucceeded.excludes': 'รอดำเนินการ ล้มเหลว ยกเลิก และหมดอายุ',
    'def.admin.payments.unappliedPayments.definition':
      'การชำระเงินที่สำเร็จแต่นำไปใช้กับคำสั่งซื้อไม่ได้ (คำสั่งซื้อถูกยกเลิก เปลี่ยนแปลง หรือยอดเงินไม่ตรง) เงินจะถูกพักไว้และเข้าคิวรอคืนเงิน',
    'def.admin.payments.unappliedPayments.includes': 'ตามที่อธิบายไว้',
    'def.admin.payments.unappliedPayments.excludes': 'การชำระเงินที่นำไปใช้กับคำสั่งซื้อแล้ว',
    'def.admin.payouts.paidOutMinor.definition':
      'เงินที่โอนให้ผู้ขายแล้ว คือการถอนเงินที่เสร็จสิ้นในช่วงวันที่เลือก',
    'def.admin.payouts.paidOutMinor.includes': 'ตามที่อธิบายไว้',
    'def.admin.payouts.paidOutMinor.excludes': 'รายการอื่น',
    'def.admin.payouts.payoutsFailed.definition':
      'การถอนเงินที่ผู้ให้บริการแจ้งว่าล้มเหลวในช่วงวันที่เลือก (เงินถูกคืนกลับให้ผู้ขายแล้ว)',
    'def.admin.payouts.payoutsFailed.includes': 'ตามที่อธิบายไว้',
    'def.admin.payouts.payoutsFailed.excludes': 'รายการอื่น',
    'def.admin.payouts.payoutsPendingMinor.definition':
      'การถอนเงินที่ขอแล้วแต่ยังไม่ได้โอน ไม่ถูกปฏิเสธ และไม่ถูกยกเลิก',
    'def.admin.payouts.payoutsPendingMinor.includes': 'ทุกช่วงวันที่',
    'def.admin.payouts.payoutsPendingMinor.excludes':
      'รายการที่โอนแล้ว ล้มเหลว ถูกปฏิเสธ และยกเลิก',
    'def.admin.payouts.sellerBalancesMinor.definition':
      'ยอดรวมของยอดเงินรายได้ของผู้ขายทุกคน คือยอดรอรับ (ยังไม่ส่งถึง) รวมกับยอดที่ถอนได้',
    'def.admin.payouts.sellerBalancesMinor.includes': 'ผู้ขายทุกคน',
    'def.admin.payouts.sellerBalancesMinor.excludes': 'บัญชีของแพลตฟอร์ม',
    'def.admin.payouts.sellerBalancesMinor.caveats':
      'เป็นภาพรวมหนี้สิน ณ ขณะหนึ่ง จากข้อมูลที่สรุปจากบัญชีแยกประเภท',
    'def.admin.payouts.withdrawalsRequested.definition':
      'คำขอถอนเงินของผู้ขายที่สร้างในช่วงวันที่เลือก',
    'def.admin.payouts.withdrawalsRequested.includes': 'ทุกสถานะ',
    'def.admin.payouts.withdrawalsRequested.excludes': 'ไม่มี',
    'def.admin.refunds.refundedMinor.definition':
      'เงินที่คืนให้ผู้ซื้อแล้ว คือการคืนเงินที่ผู้ให้บริการทำสำเร็จในช่วงวันที่เลือก',
    'def.admin.refunds.refundedMinor.includes': 'ตามที่อธิบายไว้',
    'def.admin.refunds.refundedMinor.excludes':
      'รายการที่ขอคืน อนุมัติแล้ว กำลังดำเนินการ และล้มเหลว',
    'def.admin.refunds.refundsFailed.definition':
      'การคืนเงินที่ผู้ให้บริการแจ้งว่าล้มเหลว และยังไม่ได้ลองใหม่จนสำเร็จ',
    'def.admin.refunds.refundsFailed.includes': 'ทุกช่วงวันที่',
    'def.admin.refunds.refundsFailed.excludes': 'รายการอื่น',
    'def.admin.refunds.refundsOpenMinor.definition': 'ยอดเงินของการคืนเงินที่ยังไม่เสร็จสิ้น',
    'def.admin.refunds.refundsOpenMinor.includes': 'ทุกช่วงวันที่',
    'def.admin.refunds.refundsOpenMinor.excludes': 'รายการที่เสร็จสิ้นแล้ว',
    'def.admin.refunds.refundsRequested.definition': 'คำขอคืนเงินที่สร้างในช่วงวันที่เลือก',
    'def.admin.refunds.refundsRequested.includes': 'ทุกสถานะ',
    'def.admin.refunds.refundsRequested.excludes': 'ไม่มี',
    'def.admin.registrations.registrationsApproved.definition':
      'คำขอลงทะเบียนที่ส่งในช่วงวันที่เลือก และตอนนี้อนุมัติแล้ว',
    'def.admin.registrations.registrationsApproved.includes': 'ตามที่อธิบายไว้',
    'def.admin.registrations.registrationsApproved.excludes': 'รายการอื่น',
    'def.admin.registrations.registrationsApproved.caveats':
      'เป็นผลลัพธ์ ณ วันนี้ ไม่ใช่ ณ วันสุดท้ายของช่วงวันที่เลือก',
    'def.admin.registrations.registrationsPendingNow.definition':
      'คำขอลงทะเบียนที่รอการพิจารณา ณ ตอนนี้',
    'def.admin.registrations.registrationsPendingNow.includes': 'ทุกช่วงวันที่',
    'def.admin.registrations.registrationsPendingNow.excludes': 'รายการที่พิจารณาแล้ว',
    'def.admin.registrations.registrationsSubmitted.definition':
      'คำขอลงทะเบียนยืนยันตัวตน เจ้าของฟาร์ม และผู้ขาย ที่ส่งในช่วงวันที่เลือก',
    'def.admin.registrations.registrationsSubmitted.includes': 'ทุกสถานะ',
    'def.admin.registrations.registrationsSubmitted.excludes': 'ไม่มี',
    'def.admin.users.activeUsers.definition': 'บัญชีที่ตอนนี้อยู่ในสถานะใช้งาน',
    'def.admin.users.activeUsers.includes': 'ตามที่อธิบายไว้',
    'def.admin.users.activeUsers.excludes': 'บัญชีที่ถูกระงับ ปิดใช้งาน และรอยืนยันตัวตน',
    'def.admin.users.activeUsers.caveats': 'เป็นสถานะของบัญชี ไม่ใช่การใช้งานล่าสุด',
    'def.admin.users.newUsersInRange.definition': 'บัญชีที่ลงทะเบียนในช่วงวันที่เลือก',
    'def.admin.users.newUsersInRange.includes': 'ทุกสถานะ',
    'def.admin.users.newUsersInRange.excludes': 'ไม่มี',
    'def.admin.users.suspendedUsers.definition': 'บัญชีที่ตอนนี้ถูกระงับ',
    'def.admin.users.suspendedUsers.includes': 'ตามที่อธิบายไว้',
    'def.admin.users.suspendedUsers.excludes': 'บัญชีอื่น',
    'def.admin.users.totalUsers.definition': 'บัญชีทั้งหมดที่เคยลงทะเบียน (ไม่ว่าสถานะใด)',
    'def.admin.users.totalUsers.includes': 'ทุกสถานะ',
    'def.admin.users.totalUsers.excludes': 'ไม่มี',
    'def.farm.animals.animalsOnFarm.definition':
      'สัตว์ที่ตอนนี้บันทึกไว้ว่ากำลังเลี้ยงหรือประกาศขาย',
    'def.farm.animals.animalsOnFarm.includes':
      'สัตว์ที่กำลังเลี้ยงและสัตว์ที่ประกาศขาย (เลือกดูเฉพาะชนิดสัตว์ใดชนิดหนึ่งได้)',
    'def.farm.animals.animalsOnFarm.excludes': 'สัตว์ที่ขายแล้ว ตาย ย้ายออก สูญหาย และเก็บเข้าคลัง',
    'def.farm.animals.totalRecorded.definition':
      'บันทึกสัตว์ทุกตัวที่ไม่ได้เก็บเข้าคลัง ไม่ว่าสถานะใด',
    'def.farm.animals.totalRecorded.includes': 'ทุกสถานะ',
    'def.farm.animals.totalRecorded.excludes': 'สัตว์ที่เก็บเข้าคลัง',
    'def.farm.assessments.assessmentsAccepted.definition':
      'การประเมินที่เจ้าของทำเครื่องหมายว่าตรวจดูแล้ว',
    'def.farm.assessments.assessmentsAccepted.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.assessmentsAccepted.excludes': 'รายการอื่น',
    'def.farm.assessments.assessmentsDismissed.definition': 'การประเมินที่เจ้าของปิดทิ้ง',
    'def.farm.assessments.assessmentsDismissed.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.assessmentsDismissed.excludes': 'รายการอื่น',
    'def.farm.assessments.assessmentsInRange.definition':
      'การประเมินการขายที่สร้างให้สัตว์ของฟาร์มนี้ในช่วงวันที่เลือก',
    'def.farm.assessments.assessmentsInRange.includes': 'ทั้งหมด',
    'def.farm.assessments.assessmentsInRange.excludes': 'ไม่มี',
    'def.farm.assessments.assessmentsInRange.caveats': 'ใช้ช่วยตัดสินใจ ไม่ใช่คำแนะนำ',
    'def.farm.assessments.assessmentsPending.definition':
      'การประเมินในช่วงวันที่เลือกที่เจ้าของยังไม่ได้ตรวจดูหรือปิดทิ้ง',
    'def.farm.assessments.assessmentsPending.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.assessmentsPending.excludes': 'รายการที่ตรวจดูแล้ว/ปิดทิ้งแล้ว',
    'def.farm.assessments.highConfidence.definition':
      'การประเมินที่ตัวชี้วัดความครบถ้วนของข้อมูลอยู่ในระดับสูง',
    'def.farm.assessments.highConfidence.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.highConfidence.excludes': 'รายการอื่น',
    'def.farm.assessments.lowConfidence.definition':
      'การประเมินที่ตัวชี้วัดความครบถ้วนของข้อมูลอยู่ในระดับต่ำ',
    'def.farm.assessments.lowConfidence.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.lowConfidence.excludes': 'รายการอื่น',
    'def.farm.assessments.lowConfidence.caveats':
      'เป็นตัวชี้วัดความครบถ้วนของข้อมูล ไม่ใช่ความน่าจะเป็นทางสถิติ',
    'def.farm.assessments.withPriceRange.definition':
      'การประเมินที่มีข้อมูลตลาดที่ได้รับอนุญาตเพียงพอจะแนะนำช่วงราคาได้',
    'def.farm.assessments.withPriceRange.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.assessments.withPriceRange.excludes': 'รายการอื่น',
    'def.farm.costs.costAssignedToAnimalsMinor.definition':
      'ส่วนของค่าใช้จ่ายที่บันทึกไว้ซึ่งระบุตัวสัตว์',
    'def.farm.costs.costAssignedToAnimalsMinor.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.costs.costAssignedToAnimalsMinor.excludes': 'ค่าใช้จ่ายรวมของฟาร์ม',
    'def.farm.costs.expenseRecords.definition':
      'จำนวนรายการค่าใช้จ่ายที่ประกอบเป็นค่าใช้จ่ายที่บันทึกไว้',
    'def.farm.costs.expenseRecords.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.costs.expenseRecords.excludes': 'รายการที่ยกเลิก',
    'def.farm.costs.farmWideCostMinor.definition':
      'ส่วนของค่าใช้จ่ายที่บันทึกไว้ซึ่งไม่ได้ระบุตัวสัตว์ (เช่น อาหารที่ใช้ร่วมกัน ค่าแรง อุปกรณ์)',
    'def.farm.costs.farmWideCostMinor.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.costs.farmWideCostMinor.excludes': 'ค่าใช้จ่ายที่ระบุตัวสัตว์',
    'def.farm.costs.farmWideCostMinor.caveats':
      'ไม่ได้เฉลี่ยให้สัตว์แต่ละตัว FARM+ ไม่เดาสัดส่วนให้',
    'def.farm.costs.recordedCostMinor.definition': 'ค่าใช้จ่ายที่บันทึกไว้ในช่วงวันที่เลือก',
    'def.farm.costs.recordedCostMinor.includes':
      'ค่าใช้จ่ายที่ระบุตัวสัตว์ และค่าใช้จ่ายรวมของฟาร์ม',
    'def.farm.costs.recordedCostMinor.excludes':
      'ค่าใช้จ่ายที่ยกเลิก และสิ่งที่ไม่ได้บันทึกใน FARM+',
    'def.farm.costs.recordedCostMinor.caveats':
      'เป็นเฉพาะค่าใช้จ่ายที่บันทึกไว้ ไม่ใช่ต้นทุนทั้งหมด ถ้าเลือกกรองชนิดสัตว์ จะนับเฉพาะค่าใช้จ่ายที่ระบุตัวสัตว์ชนิดนั้น',
    'def.farm.feeding.animalsFed.definition':
      'จำนวนสัตว์ (ไม่นับซ้ำ) ที่ระบุไว้ในบันทึกการให้อาหารในช่วงวันที่เลือก',
    'def.farm.feeding.animalsFed.includes': 'บันทึกรายตัว',
    'def.farm.feeding.animalsFed.excludes':
      'บันทึกแบบกลุ่ม (ไม่ได้ระบุตัวสัตว์) และบันทึกที่ยกเลิก',
    'def.farm.feeding.feedingLogsInRange.definition':
      'บันทึกการให้อาหารที่ลงวันที่ในช่วงวันที่เลือก',
    'def.farm.feeding.feedingLogsInRange.includes': 'บันทึกรายตัวและบันทึกแบบกลุ่ม',
    'def.farm.feeding.feedingLogsInRange.excludes': 'ตารางการให้อาหาร (แผน) และบันทึกที่ยกเลิก',
    'def.farm.feeding.groupFeedingLogs.definition':
      'บันทึกการให้อาหารสำหรับกลุ่ม ไม่ได้ระบุตัวสัตว์',
    'def.farm.feeding.groupFeedingLogs.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.feeding.groupFeedingLogs.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.growth.animalsWeighed.definition':
      'จำนวนสัตว์ (ไม่นับซ้ำ) ที่มีการชั่งน้ำหนักอย่างน้อยหนึ่งครั้งในช่วงวันที่เลือก',
    'def.farm.growth.animalsWeighed.includes': 'เหมือนกับการชั่งน้ำหนัก',
    'def.farm.growth.animalsWeighed.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.growth.animalsWithGainEstimate.definition':
      'สัตว์ที่ชั่งน้ำหนักอย่างน้อยสองครั้ง ห่างกันหนึ่งสัปดาห์ขึ้นไป ในช่วงวันที่เลือก',
    'def.farm.growth.animalsWithGainEstimate.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.growth.animalsWithGainEstimate.excludes':
      'สัตว์ที่ชั่งน้ำหนักครั้งเดียว หรือชั่งห่างกันไม่ถึง 7 วัน',
    'def.farm.growth.animalsWithGainEstimate.caveats':
      'การชั่งที่ห่างกันน้อยกว่านี้ ส่วนใหญ่เป็นความคลาดเคลื่อนจากการวัด',
    'def.farm.growth.averageDailyGainG.definition':
      'ค่าเฉลี่ยของอัตราโตเฉลี่ยต่อวันของสัตว์แต่ละตัวในช่วงวันที่เลือก',
    'def.farm.growth.averageDailyGainG.includes': 'สัตว์ที่นับอยู่ใน “สัตว์ที่ประเมินอัตราโตได้”',
    'def.farm.growth.averageDailyGainG.excludes':
      'สัตว์ตัวอื่นทั้งหมด (ไม่นับเป็นศูนย์ แต่ไม่นำมาคิด)',
    'def.farm.growth.averageDailyGainG.caveats':
      'เป็นค่าเฉลี่ยรายตัวแบบไม่ถ่วงน้ำหนัก ไม่ใช่ค่าถ่วงตามทั้งฝูง และรวมน้ำหนักที่ประมาณด้วยสายวัด/ด้วยสายตาด้วย',
    'def.farm.growth.estimatedWeightShare.definition':
      'สัดส่วนการชั่งน้ำหนักที่เป็นการประมาณด้วยสายวัดหรือด้วยสายตา แทนการอ่านค่าจากตาชั่ง',
    'def.farm.growth.estimatedWeightShare.includes': 'การชั่งน้ำหนักทั้งหมดในช่วงวันที่เลือก',
    'def.farm.growth.estimatedWeightShare.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.growth.weighingsInRange.definition':
      'บันทึกการชั่งน้ำหนักที่ลงวันที่ในช่วงวันที่เลือก',
    'def.farm.growth.weighingsInRange.includes':
      'น้ำหนักจากตาชั่ง จากการประมาณด้วยสายวัด และด้วยสายตา',
    'def.farm.growth.weighingsInRange.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.animalsWithIllnessOrTreatment.definition':
      'จำนวนสัตว์ (ไม่นับซ้ำ) ที่มีบันทึกเจ็บป่วยหรือการรักษาในช่วงวันที่เลือก',
    'def.farm.health.animalsWithIllnessOrTreatment.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.health.animalsWithIllnessOrTreatment.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.healthRecordsInRange.definition': 'บันทึกสุขภาพที่ลงวันที่ในช่วงวันที่เลือก',
    'def.farm.health.healthRecordsInRange.includes':
      'เจ็บป่วย การรักษา วัคซีน การหายป่วย การตรวจสุขภาพ และอื่นๆ',
    'def.farm.health.healthRecordsInRange.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.healthRecordsInRange.caveats':
      'เป็นการนับสิ่งที่บันทึกไว้เท่านั้น FARM+ ไม่ได้แปลผลบันทึกสุขภาพ',
    'def.farm.health.illnessRecords.definition': 'บันทึกสุขภาพประเภทเจ็บป่วยในช่วงวันที่เลือก',
    'def.farm.health.illnessRecords.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.health.illnessRecords.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.treatmentRecords.definition': 'บันทึกสุขภาพประเภทการรักษาในช่วงวันที่เลือก',
    'def.farm.health.treatmentRecords.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.health.treatmentRecords.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.vaccinationRecords.definition': 'บันทึกสุขภาพประเภทวัคซีนในช่วงวันที่เลือก',
    'def.farm.health.vaccinationRecords.includes': 'ตามที่กล่าวข้างต้น',
    'def.farm.health.vaccinationRecords.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.vaccinationsDueNext30Days.definition':
      'จำนวนสัตว์ (ไม่นับซ้ำ) ที่วัน “ครบกำหนดครั้งถัดไป” ที่บันทึกไว้ อยู่ภายใน 30 วันข้างหน้า',
    'def.farm.health.vaccinationsDueNext30Days.includes': 'บันทึกสุขภาพทั้งหมด',
    'def.farm.health.vaccinationsDueNext30Days.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.vaccinationsDueNext30Days.caveats': 'นับเฉพาะวันครบกำหนดที่บันทึกไว้เท่านั้น',
    'def.farm.health.withdrawalsRunning.definition':
      'จำนวนสัตว์ (ไม่นับซ้ำ) ที่มีระยะหยุดยาที่บันทึกไว้และยังไม่สิ้นสุด',
    'def.farm.health.withdrawalsRunning.includes': 'บันทึกสุขภาพทั้งหมด ไม่ว่าลงวันที่ใด',
    'def.farm.health.withdrawalsRunning.excludes': 'บันทึกที่ยกเลิก',
    'def.farm.health.withdrawalsRunning.caveats': 'นับเฉพาะระยะหยุดยาที่บันทึกไว้เท่านั้น',
    'def.farm.listings.activeListings.definition': 'ประกาศขายสัตว์ที่กำลังเปิดขายอยู่ตอนนี้',
    'def.farm.listings.activeListings.includes': 'ประกาศขายของฟาร์มนี้',
    'def.farm.listings.activeListings.excludes':
      'ฉบับร่าง รอตรวจสอบ ติดจอง หยุดชั่วคราว ขายแล้ว หมดอายุ และยกเลิก',
    'def.farm.listings.listingsCreatedInRange.definition': 'ประกาศขายที่สร้างในช่วงวันที่เลือก',
    'def.farm.listings.listingsCreatedInRange.includes': 'ทุกสถานะ',
    'def.farm.listings.listingsCreatedInRange.excludes': 'ไม่มี',
    'def.farm.listings.pendingReviewListings.definition': 'ประกาศขายที่ส่งแล้วและรอผู้ดูแลตรวจสอบ',
    'def.farm.listings.pendingReviewListings.includes': 'ฟาร์มนี้',
    'def.farm.listings.pendingReviewListings.excludes': 'สถานะอื่น',
    'def.farm.listings.reservedListings.definition':
      'ประกาศขายที่ตกลงซื้อขายแล้ว และรอการสั่งซื้อ/ชำระเงิน',
    'def.farm.listings.reservedListings.includes': 'ฟาร์มนี้',
    'def.farm.listings.reservedListings.excludes': 'สถานะอื่น',
    'def.farm.products.activeProducts.definition': 'สินค้าในร้านค้าที่กำลังเปิดขายอยู่ตอนนี้',
    'def.farm.products.activeProducts.includes': 'ฟาร์มนี้',
    'def.farm.products.activeProducts.excludes': 'สถานะอื่น',
    'def.farm.products.lowStockProducts.definition':
      'สินค้าที่เปิดขายและยังมีของ แต่เหลือเท่ากับหรือต่ำกว่าระดับเตือนสต็อกต่ำที่ตั้งไว้ของสินค้านั้น',
    'def.farm.products.lowStockProducts.includes': 'สินค้าที่ตั้งระดับเตือนไว้',
    'def.farm.products.lowStockProducts.excludes': 'สินค้าที่ไม่ได้ตั้งระดับเตือน',
    'def.farm.products.outOfStockProducts.definition': 'สินค้าที่เปิดขายแต่ไม่มีของให้สั่งซื้อ',
    'def.farm.products.outOfStockProducts.includes': 'ฟาร์มนี้',
    'def.farm.products.outOfStockProducts.excludes': 'สถานะอื่น',
    'def.farm.products.pendingReviewProducts.definition': 'สินค้าที่ส่งแล้วและรอผู้ดูแลตรวจสอบ',
    'def.farm.products.pendingReviewProducts.includes': 'ฟาร์มนี้',
    'def.farm.products.pendingReviewProducts.excludes': 'สถานะอื่น',
    'def.farm.products.productGrossSalesMinor.definition':
      'ยอดขายรวมจากคำสั่งซื้อในร้านค้า (ส่วนของร้านค้าในยอดขายรวม)',
    'def.farm.products.productGrossSalesMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก (เฉพาะคำสั่งซื้อจากร้านค้า)',
    'def.farm.products.productGrossSalesMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.products.productGrossSalesMinor.caveats':
      'เท่ากับยอดขายรวม เมื่อกรองเฉพาะคำสั่งซื้อจากร้านค้า',
    'def.farm.products.unitsSold.definition':
      'จำนวนชิ้นในคำสั่งซื้อจากร้านค้าที่ชำระแล้วและยังไม่ถูกยกเลิกหรือคืนเงิน ในช่วงวันที่เลือก',
    'def.farm.products.unitsSold.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก (เฉพาะคำสั่งซื้อจากร้านค้า)',
    'def.farm.products.unitsSold.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.sales.averageOrderValueMinor.definition':
      'ยอดขายรวมต่อคำสั่งซื้อที่ชำระแล้วหนึ่งรายการ',
    'def.farm.sales.averageOrderValueMinor.includes': 'เหมือนยอดขายรวม',
    'def.farm.sales.averageOrderValueMinor.excludes': 'เหมือนยอดขายรวม',
    'def.farm.sales.cancelledOrders.definition':
      'คำสั่งซื้อที่สั่งในช่วงวันที่เลือกและถูกยกเลิก (ไม่เคยชำระเงิน หรือหมดอายุ)',
    'def.farm.sales.cancelledOrders.includes': 'ตามที่อธิบายไว้',
    'def.farm.sales.cancelledOrders.excludes': 'คำสั่งซื้อที่คืนเงินแล้ว',
    'def.farm.sales.estimatedNetProceedsMinor.definition':
      'ยอดขายรวมหักค่าธรรมเนียมแพลตฟอร์ม คือเงินที่คาดว่าฟาร์มจะได้รับจากยอดขายนี้',
    'def.farm.sales.estimatedNetProceedsMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.farm.sales.estimatedNetProceedsMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.sales.estimatedNetProceedsMinor.caveats':
      'เป็นค่าประมาณ ยังไม่หักค่าจัดส่งของผู้ขาย ค่าธรรมเนียมผู้ให้บริการชำระเงิน ภาษี และต้นทุนนอก FARM+ ไม่ใช่กำไร',
    'def.farm.sales.grossSalesMinor.definition':
      'ราคาสินค้าของคำสั่งซื้อที่ชำระแล้วและยังไม่ถูกยกเลิกหรือคืนเงิน ไม่รวมค่าจัดส่ง',
    'def.farm.sales.grossSalesMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.farm.sales.grossSalesMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.sales.grossSalesMinor.caveats':
      'ไม่ใช่กำไร และไม่ใช่รายรับหลังหักค่าธรรมเนียม ดูที่ รายรับสุทธิโดยประมาณ',
    'def.farm.sales.netProceedsOverRecordedCostMinor.definition':
      'รายรับสุทธิโดยประมาณ หักค่าใช้จ่ายที่บันทึกไว้ในช่วงวันที่เดียวกัน เป็นตัวชี้วัดคร่าวๆ แสดงเฉพาะเมื่อคุณมีสิทธิ์ดูค่าใช้จ่าย',
    'def.farm.sales.netProceedsOverRecordedCostMinor.includes': 'ทั้งสองค่าตามที่นิยามไว้ข้างต้น',
    'def.farm.sales.netProceedsOverRecordedCostMinor.excludes':
      'ค่าใช้จ่ายที่ไม่ได้บันทึก และความต่างของช่วงเวลา (ค่าใช้จ่ายของสัตว์หนึ่งตัวกินเวลาหลายเดือน)',
    'def.farm.sales.netProceedsOverRecordedCostMinor.caveats':
      'ไม่ใช่กำไร เพราะไม่รวมค่าใช้จ่ายที่ไม่ได้บันทึก ค่าจัดส่ง ภาษี และค่าธรรมเนียม และค่าใช้จ่ายกับยอดขายของสัตว์ต่างตัวกันอาจอยู่คนละช่วงเวลา',
    'def.farm.sales.netProceedsPendingMinor.definition':
      'ส่วนของรายรับสุทธิโดยประมาณจากคำสั่งซื้อที่ชำระแล้วแต่ยังไม่ส่งถึง (พักไว้จนกว่าจะส่งถึง)',
    'def.farm.sales.netProceedsPendingMinor.includes': 'คำสั่งซื้อที่ชำระแล้วและยังดำเนินการอยู่',
    'def.farm.sales.netProceedsPendingMinor.excludes': 'คำสั่งซื้อที่ส่งถึงแล้ว',
    'def.farm.sales.netProceedsReleasedMinor.definition':
      'ส่วนของรายรับสุทธิโดยประมาณจากคำสั่งซื้อที่ส่งถึงแล้ว คือรายได้ที่ถอนเงินได้แล้ว',
    'def.farm.sales.netProceedsReleasedMinor.includes':
      'คำสั่งซื้อที่ชำระแล้วและถึงสถานะส่งถึงแล้ว (DELIVERED)',
    'def.farm.sales.netProceedsReleasedMinor.excludes': 'คำสั่งซื้อที่ยังดำเนินการอยู่',
    'def.farm.sales.ordersCreated.definition': 'คำสั่งซื้อของฟาร์มนี้ที่สร้างในช่วงวันที่เลือก',
    'def.farm.sales.ordersCreated.includes': 'ทุกสถานะ',
    'def.farm.sales.ordersCreated.excludes': 'ไม่มี',
    'def.farm.sales.ordersCreated.caveats': 'รวมคำสั่งซื้อที่ไม่เคยชำระเงินด้วย',
    'def.farm.sales.ordersPaid.definition':
      'คำสั่งซื้อที่ยืนยันการชำระเงินในช่วงวันที่เลือก และยังไม่ถูกยกเลิกหรือคืนเงิน',
    'def.farm.sales.ordersPaid.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.farm.sales.ordersPaid.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.sales.platformCommissionMinor.definition':
      'ค่าธรรมเนียมที่ FARM+ เก็บจากยอดขายเหล่านั้น ตามที่กำหนดไว้ในแต่ละคำสั่งซื้อตอนสั่งซื้อ',
    'def.farm.sales.platformCommissionMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.farm.sales.platformCommissionMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'def.farm.sales.platformCommissionMinor.caveats':
      'ถ้ามีการเปลี่ยนกฎค่าธรรมเนียมภายหลัง ค่านี้จะไม่เปลี่ยนตาม',
    'def.farm.sales.refundedGrossMinor.definition':
      'ราคาสินค้าของคำสั่งซื้อที่ชำระในช่วงวันที่เลือก และตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) ไม่นับรวมในยอดขายรวม',
    'def.farm.sales.refundedGrossMinor.includes': 'ตามที่อธิบายไว้',
    'def.farm.sales.refundedGrossMinor.excludes': 'รายการอื่นทั้งหมด',
    'def.farm.sales.shippingCollectedMinor.definition':
      'ค่าจัดส่งที่ผู้ซื้อจ่ายในคำสั่งซื้อเหล่านั้น แยกไว้ต่างหากจากยอดขาย เพราะเป็นเงินที่ส่งต่อ ไม่ใช่รายได้จากสินค้า',
    'def.farm.sales.shippingCollectedMinor.includes':
      'คำสั่งซื้อที่มีสถานะชำระแล้ว (PAID), กำลังดำเนินการ (PROCESSING), จัดส่งแล้ว (SHIPPED) หรือส่งถึงแล้ว (DELIVERED) และยืนยันการชำระเงิน (paidAt) ในช่วงวันที่เลือก',
    'def.farm.sales.shippingCollectedMinor.excludes':
      'คำสั่งซื้อที่ถูกยกเลิกก่อนชำระเงิน และคำสั่งซื้อที่ชำระแล้วแต่ตอนนี้อยู่ในสถานะรอคืนเงิน (REFUND_PENDING) หรือคืนเงินแล้ว (REFUNDED) (แสดงแยกไว้เป็นรายการที่ไม่นับ/คืนเงินแล้ว)',
    'alert.unapplied_payments':
      'รับเงินแล้ว {count} รายการแต่ผูกกับคำสั่งซื้อไม่ได้ (พักไว้ {amount} ต้องคืนเงิน)',
    'alert.failed_refunds': 'คืนเงินไม่สำเร็จที่ผู้ให้บริการ {count} รายการ ต้องลองใหม่',
    'alert.failed_payouts':
      'โอนเงินให้ผู้ขายไม่สำเร็จ {count} รายการใน 7 วันที่ผ่านมา (เงินคืนเข้าบัญชีผู้ขายแล้ว)',
    'alert.stale_withdrawals': 'มีคำขอถอนเงิน {count} รายการที่รอพิจารณาเกิน 3 วัน',
    'alert.payment_failure_rate':
      'ชำระเงินไม่สำเร็จ {count} จาก {total} รายการใน 24 ชั่วโมงที่ผ่านมา ({percent}%)',
    'alert.stale_payment_attempts':
      'มีการชำระเงิน {count} รายการที่เลยเวลาแล้วแต่ยังไม่หมดอายุ (ระบบงานเบื้องหลังจะจัดการให้)',
  },
  en: {
    'metric.farm.animals.animalsOnFarm': 'Animals on the farm',
    'metric.farm.animals.totalRecorded': 'All animals recorded',
    'metric.farm.growth.weighingsInRange': 'Weighings recorded',
    'metric.farm.growth.animalsWeighed': 'Animals weighed',
    'metric.farm.growth.animalsWithGainEstimate': 'Animals with a gain estimate',
    'metric.farm.growth.averageDailyGainG': 'Average daily gain',
    'metric.farm.growth.estimatedWeightShare': 'Estimated weights',
    'metric.farm.health.healthRecordsInRange': 'Health records',
    'metric.farm.health.illnessRecords': 'Illness records',
    'metric.farm.health.treatmentRecords': 'Treatment records',
    'metric.farm.health.vaccinationRecords': 'Vaccination records',
    'metric.farm.health.animalsWithIllnessOrTreatment':
      'Animals with an illness or treatment record',
    'metric.farm.health.withdrawalsRunning': 'Animals in a medicine withdrawal period',
    'metric.farm.health.vaccinationsDueNext30Days': 'Animals with a vaccination due in 30 days',
    'metric.farm.feeding.feedingLogsInRange': 'Feeding logs',
    'metric.farm.feeding.animalsFed': 'Animals with a feeding log',
    'metric.farm.feeding.groupFeedingLogs': 'Group feeding logs',
    'metric.farm.costs.recordedCostMinor': 'Recorded costs',
    'metric.farm.costs.expenseRecords': 'Expense records',
    'metric.farm.costs.costAssignedToAnimalsMinor': 'Costs assigned to animals',
    'metric.farm.costs.farmWideCostMinor': 'Farm-wide costs',
    'metric.farm.listings.activeListings': 'Active animal listings',
    'metric.farm.listings.reservedListings': 'Reserved listings',
    'metric.farm.listings.pendingReviewListings': 'Listings awaiting review',
    'metric.farm.listings.listingsCreatedInRange': 'Listings created',
    'metric.farm.sales.ordersCreated': 'Orders placed',
    'metric.farm.sales.ordersPaid': 'Paid orders',
    'metric.farm.sales.grossSalesMinor': 'Gross sales',
    'metric.farm.sales.shippingCollectedMinor': 'Shipping collected',
    'metric.farm.sales.platformCommissionMinor': 'Platform commission',
    'metric.farm.sales.estimatedNetProceedsMinor': 'Estimated net proceeds',
    'metric.farm.sales.netProceedsReleasedMinor': 'Net proceeds released',
    'metric.farm.sales.netProceedsPendingMinor': 'Net proceeds pending',
    'metric.farm.sales.refundedGrossMinor': 'Refunded or being refunded (excluded)',
    'metric.farm.sales.cancelledOrders': 'Cancelled orders',
    'metric.farm.sales.averageOrderValueMinor': 'Average order value',
    'metric.farm.sales.netProceedsOverRecordedCostMinor': 'Net proceeds over recorded costs',
    'metric.farm.products.activeProducts': 'Active products',
    'metric.farm.products.pendingReviewProducts': 'Products awaiting review',
    'metric.farm.products.outOfStockProducts': 'Active products out of stock',
    'metric.farm.products.lowStockProducts': 'Active products low on stock',
    'metric.farm.products.unitsSold': 'Product units sold',
    'metric.farm.products.productGrossSalesMinor': 'Product gross sales',
    'metric.farm.assessments.assessmentsInRange': 'AI assessments run',
    'metric.farm.assessments.assessmentsPending': 'Assessments awaiting your review',
    'metric.farm.assessments.assessmentsAccepted': 'Assessments reviewed',
    'metric.farm.assessments.assessmentsDismissed': 'Assessments dismissed',
    'metric.farm.assessments.withPriceRange': 'Assessments with a price range',
    'metric.farm.assessments.lowConfidence': 'Low-confidence assessments',
    'metric.farm.assessments.highConfidence': 'High-confidence assessments',
    'metric.admin.users.totalUsers': 'Registered users',
    'metric.admin.users.newUsersInRange': 'New users',
    'metric.admin.users.activeUsers': 'Active accounts',
    'metric.admin.users.suspendedUsers': 'Suspended accounts',
    'metric.admin.registrations.registrationsSubmitted': 'Registrations submitted',
    'metric.admin.registrations.registrationsApproved': 'Of those, approved',
    'metric.admin.registrations.registrationsPendingNow': 'Registrations waiting now',
    'metric.admin.farms.activeFarms': 'Active farms',
    'metric.admin.farms.newFarmsInRange': 'New farms',
    'metric.admin.farms.farmsWithSalesInRange': 'Farms with paid orders',
    'metric.admin.listings.activeListings': 'Active animal listings',
    'metric.admin.listings.activeProducts': 'Active products',
    'metric.admin.listings.listingsCreatedInRange': 'Listings created',
    'metric.admin.orders.ordersCreated': 'Orders placed',
    'metric.admin.orders.ordersPaid': 'Paid orders',
    'metric.admin.orders.gmvMinor': 'Gross merchandise value',
    'metric.admin.orders.shippingMinor': 'Shipping charged',
    'metric.admin.orders.buyerPaidTotalMinor': 'Total paid by buyers',
    'metric.admin.orders.cancelledOrders': 'Cancelled orders',
    'metric.admin.orders.refundedOrders': 'Refunded or being refunded',
    'metric.admin.payments.paymentAttempts': 'Payment attempts',
    'metric.admin.payments.paymentsSucceeded': 'Payments succeeded',
    'metric.admin.payments.paymentsFailed': 'Payments failed',
    'metric.admin.payments.paymentSuccessRate': 'Payment success rate',
    'metric.admin.payments.amountReceivedMinor': 'Amount received',
    'metric.admin.payments.unappliedPayments': 'Payments not applied to an order',
    'metric.admin.commissions.commissionMinor': 'Platform commission',
    'metric.admin.commissions.commissionReleasedMinor': 'Commission on delivered orders',
    'metric.admin.commissions.commissionInProgressMinor': 'Commission on orders in progress',
    'metric.admin.commissions.commissionBookedNetMinor': 'Commission booked in the ledger (net)',
    'metric.admin.refunds.refundsRequested': 'Refunds requested',
    'metric.admin.refunds.refundedMinor': 'Amount refunded',
    'metric.admin.refunds.refundsOpenMinor': 'Refunds waiting',
    'metric.admin.refunds.refundsFailed': 'Refunds failed',
    'metric.admin.payouts.withdrawalsRequested': 'Withdrawals requested',
    'metric.admin.payouts.paidOutMinor': 'Amount paid out',
    'metric.admin.payouts.payoutsPendingMinor': 'Payouts waiting',
    'metric.admin.payouts.sellerBalancesMinor': 'Owed to sellers (ledger)',
    'metric.admin.payouts.payoutsFailed': 'Payouts failed',
    'metric.admin.moderation.listingsPendingReview': 'Listings awaiting review',
    'metric.admin.moderation.productsPendingReview': 'Products awaiting review',
    'metric.admin.moderation.openContentReports': 'Open content reports',
    'metric.admin.moderation.oldestPendingHours': 'Longest wait in the queue',
    'metric.admin.alerts.alertCount': 'Open alerts',
    'metric.admin.alerts.failedPaymentsLast24h': 'Failed payments (last 24 hours)',
    'table.animals.byTypeAndStatus': 'By type and status',
    'table.growth.gainByAnimal': 'Gain by animal',
    'table.health.byType': 'By type',
    'table.feeding.byCategory': 'By feed category',
    'table.costs.byCategory': 'By category',
    'table.listings.byStatus': 'Listings by status',
    'table.sales.ordersByStatus': 'Orders by status',
    'table.sales.recentOrders': 'Recent orders',
    'table.products.topProducts': 'Top products',
    'table.users.byStatus': 'Accounts by status',
    'table.registrations.byStatus': 'Registrations by status',
    'table.listings.listingsByStatus': 'Listings by status',
    'table.orders.ordersByStatus': 'Orders by status',
    'table.payments.byStatus': 'Payments by status',
    'table.commissions.commissionByOrderType': 'Commission by order type',
    'series.weighings': 'Weighings',
    'series.healthRecords': 'Health records',
    'series.feedingLogs': 'Feeding logs',
    'series.recordedCosts': 'Recorded costs',
    'series.grossSales': 'Gross sales',
    'series.netProceeds': 'Net proceeds',
    'series.newUsers': 'New users',
    'series.submitted': 'Submitted',
    'series.newFarms': 'New farms',
    'series.gmv': 'Gross merchandise value',
    'series.amountReceived': 'Amount received',
    'col.animalType': 'Animal type',
    'col.total': 'Total',
    'col.animal': 'Animal',
    'col.firstKg': 'First kg',
    'col.latestKg': 'Latest kg',
    'col.days': 'Days',
    'col.adg': 'Average daily gain (g/day)',
    'col.type': 'Type',
    'col.records': 'Records',
    'col.feedCategory': 'Feed category',
    'col.logs': 'Logs',
    'col.category': 'Category',
    'col.amount': 'Amount',
    'col.status': 'Status',
    'col.listings': 'Listings',
    'col.ordersPlaced': 'Orders placed',
    'col.order': 'Order',
    'col.placed': 'Placed',
    'col.items': 'Items',
    'col.grossItems': 'Gross (items)',
    'col.platformFee': 'Platform fee',
    'col.netProceeds': 'Net proceeds',
    'col.product': 'Product',
    'col.units': 'Units',
    'col.accounts': 'Accounts',
    'col.statusNow': 'Status (now)',
    'col.submittedInRange': 'Submitted in range',
    'col.payments': 'Payments',
    'col.orderType': 'Order type',
    'col.commission': 'Commission',
    'value.orderKind.animal': 'Animal',
    'value.orderKind.product': 'Product',
    'value.unknownType': 'Unknown',
    'note.healthNoDiagnosis':
      'Counts of what was recorded. FARM+ does not interpret health records or diagnose.',
    'note.costsTypeFilter':
      'With an animal-type filter, only costs assigned to animals of that type are counted; farm-wide costs are left out.',
    'note.salesStatusNow':
      'Statuses are as of now: an order paid in these dates and refunded later is excluded.',
    'note.netNotProfit':
      'Estimated net proceeds are before shipping costs, provider fees and taxes, and are not profit.',
    'note.salesNoTypeFilter':
      'The animal-type filter does not apply to sales: these figures cover every order of the farm.',
    'note.aiNotAdvice': 'AI assessments are decision support, not advice.',
    'note.gmvNotRevenue':
      'Gross merchandise value is what buyers paid for goods and animals. It is not FARM+’s revenue: that is the platform commission.',
    'note.commissionNotProfit':
      'Commission is the platform’s revenue from sales; gross merchandise value is what buyers paid sellers for goods. Neither is profit.',
    'note.ledgerBasis':
      'The ledger figure is booked by payment/refund date; the order figure by payment date and current status.',
    'reason.farmAnimals': 'You do not have permission to see animals on this farm.',
    'reason.farmRecords': 'You do not have permission to read this farm’s records.',
    'reason.farmExpenses': 'You do not have permission to see this farm’s expenses.',
    'reason.farmSelling': 'Selling information is for the farm’s owners and managers.',
    'reason.adminUsers': 'Needs permission to read users.',
    'reason.adminRegistrations': 'Needs permission to review registrations.',
    'reason.adminFarms': 'Needs permission to read farms.',
    'reason.adminReports': 'Needs permission to read reports.',
    'reason.adminPayments': 'Financial figures need the payments permission.',
    'reason.adminModeration': 'Needs a moderation permission.',
    'reason.adminAlerts': 'Financial alerts need the payments permission.',
    'filter.animalType': 'Animal type',
    'filter.orderKind': 'Order type',
    'def.admin.alerts.alertCount.definition':
      'Number of alert rules currently raised (see the list).',
    'def.admin.alerts.alertCount.includes': 'Payment, refund and payout alerts.',
    'def.admin.alerts.alertCount.excludes': 'None.',
    'def.admin.alerts.failedPaymentsLast24h.definition':
      'Payments reported as failed in the last 24 hours, regardless of the selected dates.',
    'def.admin.alerts.failedPaymentsLast24h.includes': 'As described.',
    'def.admin.alerts.failedPaymentsLast24h.excludes': 'Others.',
    'def.admin.commissions.commissionBookedNetMinor.definition':
      'Net movement of the platform account in the ledger inside the dates: commission credited at payment minus commission reversed by refunds, by the date it was booked.',
    'def.admin.commissions.commissionBookedNetMinor.includes': 'Capture and refund journals.',
    'def.admin.commissions.commissionBookedNetMinor.excludes': 'None.',
    'def.admin.commissions.commissionBookedNetMinor.caveats':
      'Equals the order-based commission when each refund is booked in the same dates as its payment; a refund booked in a later period lowers that period’s figure instead.',
    'def.admin.commissions.commissionInProgressMinor.definition':
      'Commission from paid orders not yet delivered (a refund could still reverse it).',
    'def.admin.commissions.commissionInProgressMinor.includes': 'As described.',
    'def.admin.commissions.commissionInProgressMinor.excludes': 'Delivered.',
    'def.admin.commissions.commissionMinor.definition':
      'The fee FARM+ keeps from paid, standing orders (frozen on each order at checkout). This is FARM+’s revenue from sales.',
    'def.admin.commissions.commissionMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.commissions.commissionMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.admin.commissions.commissionMinor.caveats':
      'Before FARM+’s own costs and provider fees: not profit.',
    'def.admin.commissions.commissionReleasedMinor.definition':
      'Part of the commission from orders already delivered (no refund can follow).',
    'def.admin.commissions.commissionReleasedMinor.includes': 'Paid orders that reached DELIVERED.',
    'def.admin.commissions.commissionReleasedMinor.excludes': 'In progress.',
    'def.admin.farms.activeFarms.definition': 'Farms that are not archived.',
    'def.admin.farms.activeFarms.includes': 'As described.',
    'def.admin.farms.activeFarms.excludes': 'Archived farms.',
    'def.admin.farms.farmsWithSalesInRange.definition':
      'Different farms with at least one paid, standing order in the dates.',
    'def.admin.farms.farmsWithSalesInRange.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.farms.farmsWithSalesInRange.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.admin.farms.newFarmsInRange.definition': 'Farms created inside the dates.',
    'def.admin.farms.newFarmsInRange.includes': 'Any status.',
    'def.admin.farms.newFarmsInRange.excludes': 'None.',
    'def.admin.listings.activeListings.definition': 'Animal listings on sale now, platform-wide.',
    'def.admin.listings.activeListings.includes': 'All farms.',
    'def.admin.listings.activeListings.excludes': 'Other statuses.',
    'def.admin.listings.activeProducts.definition': 'Shop products on sale now, platform-wide.',
    'def.admin.listings.activeProducts.includes': 'All farms.',
    'def.admin.listings.activeProducts.excludes': 'Other statuses.',
    'def.admin.listings.listingsCreatedInRange.definition':
      'Animal listings created inside the dates.',
    'def.admin.listings.listingsCreatedInRange.includes': 'Every status.',
    'def.admin.listings.listingsCreatedInRange.excludes': 'None.',
    'def.admin.moderation.listingsPendingReview.definition':
      'Animal listings waiting for a moderator.',
    'def.admin.moderation.listingsPendingReview.includes': 'All farms.',
    'def.admin.moderation.listingsPendingReview.excludes': 'Others.',
    'def.admin.moderation.oldestPendingHours.definition':
      'Age of the oldest listing or product still awaiting review.',
    'def.admin.moderation.oldestPendingHours.includes': 'Listings and products awaiting review.',
    'def.admin.moderation.oldestPendingHours.excludes': 'Reports and registrations.',
    'def.admin.moderation.openContentReports.definition':
      'Reports of posts, comments or videos not yet actioned or dismissed.',
    'def.admin.moderation.openContentReports.includes': 'All.',
    'def.admin.moderation.openContentReports.excludes': 'Closed.',
    'def.admin.moderation.productsPendingReview.definition':
      'Shop products waiting for a moderator.',
    'def.admin.moderation.productsPendingReview.includes': 'All farms.',
    'def.admin.moderation.productsPendingReview.excludes': 'Others.',
    'def.admin.orders.buyerPaidTotalMinor.definition':
      'Everything buyers paid on those orders: items plus shipping.',
    'def.admin.orders.buyerPaidTotalMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.orders.buyerPaidTotalMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.admin.orders.cancelledOrders.definition':
      'Orders placed in the dates and cancelled before payment.',
    'def.admin.orders.cancelledOrders.includes': 'As described.',
    'def.admin.orders.cancelledOrders.excludes': 'Refunded orders.',
    'def.admin.orders.gmvMinor.definition':
      'Item price of paid, standing orders across the platform (what buyers paid for goods and animals). It is NOT FARM+’s revenue.',
    'def.admin.orders.gmvMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.orders.gmvMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded); shipping',
    'def.admin.orders.gmvMinor.caveats': 'Platform revenue is the commission only.',
    'def.admin.orders.ordersCreated.definition': 'Orders created inside the dates.',
    'def.admin.orders.ordersCreated.includes': 'Every status.',
    'def.admin.orders.ordersCreated.excludes': 'None.',
    'def.admin.orders.ordersPaid.definition': 'Orders paid inside the dates that still stand.',
    'def.admin.orders.ordersPaid.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.orders.ordersPaid.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.admin.orders.refundedOrders.definition':
      'Orders paid in the dates that are now REFUND_PENDING or REFUNDED.',
    'def.admin.orders.refundedOrders.includes': 'As described.',
    'def.admin.orders.refundedOrders.excludes': 'Others.',
    'def.admin.orders.shippingMinor.definition':
      'Delivery charges on those orders (passed on, not revenue).',
    'def.admin.orders.shippingMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.admin.orders.shippingMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.admin.payments.amountReceivedMinor.definition':
      'What the provider reports having captured on succeeded payments created in the dates.',
    'def.admin.payments.amountReceivedMinor.includes': 'As described.',
    'def.admin.payments.amountReceivedMinor.excludes': 'Failed and pending.',
    'def.admin.payments.amountReceivedMinor.caveats':
      'Includes money later refunded and money not applied to an order.',
    'def.admin.payments.paymentAttempts.definition': 'Payments started inside the dates.',
    'def.admin.payments.paymentAttempts.includes': 'Every status.',
    'def.admin.payments.paymentAttempts.excludes': 'None.',
    'def.admin.payments.paymentSuccessRate.definition':
      'Share of finished attempts that succeeded.',
    'def.admin.payments.paymentSuccessRate.includes': 'Attempts with a final outcome.',
    'def.admin.payments.paymentSuccessRate.excludes':
      'Still pending, cancelled and expired attempts (abandoned, not declined).',
    'def.admin.payments.paymentsFailed.definition':
      'Of those, payments the provider reported as failed.',
    'def.admin.payments.paymentsFailed.includes': 'As described.',
    'def.admin.payments.paymentsFailed.excludes': 'Others.',
    'def.admin.payments.paymentsSucceeded.definition': 'Of those, payments the provider confirmed.',
    'def.admin.payments.paymentsSucceeded.includes':
      'Refunded payments were successful payments first.',
    'def.admin.payments.paymentsSucceeded.excludes': 'Pending, failed, cancelled, expired.',
    'def.admin.payments.unappliedPayments.definition':
      'Payments that succeeded but could not be applied to their order (cancelled, changed, wrong amount); the money is parked and queued for refund.',
    'def.admin.payments.unappliedPayments.includes': 'As described.',
    'def.admin.payments.unappliedPayments.excludes': 'Applied payments.',
    'def.admin.payouts.paidOutMinor.definition':
      'Money paid to sellers: withdrawals completed inside the dates.',
    'def.admin.payouts.paidOutMinor.includes': 'As described.',
    'def.admin.payouts.paidOutMinor.excludes': 'Others.',
    'def.admin.payouts.payoutsFailed.definition':
      'Withdrawals the provider reported as failed in the dates (funds were returned to the seller).',
    'def.admin.payouts.payoutsFailed.includes': 'As described.',
    'def.admin.payouts.payoutsFailed.excludes': 'Others.',
    'def.admin.payouts.payoutsPendingMinor.definition':
      'Withdrawals requested but not yet paid, rejected or cancelled.',
    'def.admin.payouts.payoutsPendingMinor.includes': 'All dates.',
    'def.admin.payouts.payoutsPendingMinor.excludes': 'Paid, failed, rejected, cancelled.',
    'def.admin.payouts.sellerBalancesMinor.definition':
      'Total of all seller earnings balances: pending (not yet delivered) plus available.',
    'def.admin.payouts.sellerBalancesMinor.includes': 'All sellers.',
    'def.admin.payouts.sellerBalancesMinor.excludes': 'Platform accounts.',
    'def.admin.payouts.sellerBalancesMinor.caveats':
      'A liability snapshot from the ledger projection.',
    'def.admin.payouts.withdrawalsRequested.definition':
      'Seller withdrawal requests created inside the dates.',
    'def.admin.payouts.withdrawalsRequested.includes': 'Every status.',
    'def.admin.payouts.withdrawalsRequested.excludes': 'None.',
    'def.admin.refunds.refundedMinor.definition':
      'Money returned to buyers: refunds the provider completed inside the dates.',
    'def.admin.refunds.refundedMinor.includes': 'As described.',
    'def.admin.refunds.refundedMinor.excludes': 'Requested, approved, processing, failed.',
    'def.admin.refunds.refundsFailed.definition':
      'Refunds the provider reported as failed and not yet retried to success.',
    'def.admin.refunds.refundsFailed.includes': 'All dates.',
    'def.admin.refunds.refundsFailed.excludes': 'Others.',
    'def.admin.refunds.refundsOpenMinor.definition': 'Amount of refunds not yet completed.',
    'def.admin.refunds.refundsOpenMinor.includes': 'All dates.',
    'def.admin.refunds.refundsOpenMinor.excludes': 'Completed.',
    'def.admin.refunds.refundsRequested.definition': 'Refund requests created inside the dates.',
    'def.admin.refunds.refundsRequested.includes': 'Every status.',
    'def.admin.refunds.refundsRequested.excludes': 'None.',
    'def.admin.registrations.registrationsApproved.definition':
      'Registrations submitted in the dates that are now approved.',
    'def.admin.registrations.registrationsApproved.includes': 'As described.',
    'def.admin.registrations.registrationsApproved.excludes': 'Others.',
    'def.admin.registrations.registrationsApproved.caveats':
      'Outcome today, not at the end of the dates.',
    'def.admin.registrations.registrationsPendingNow.definition':
      'Registrations awaiting a decision at this moment.',
    'def.admin.registrations.registrationsPendingNow.includes': 'All dates.',
    'def.admin.registrations.registrationsPendingNow.excludes': 'Decided.',
    'def.admin.registrations.registrationsSubmitted.definition':
      'Identity, farm-owner and seller registrations submitted inside the dates.',
    'def.admin.registrations.registrationsSubmitted.includes': 'Every status.',
    'def.admin.registrations.registrationsSubmitted.excludes': 'None.',
    'def.admin.users.activeUsers.definition': 'Accounts currently in status active.',
    'def.admin.users.activeUsers.includes': 'As described.',
    'def.admin.users.activeUsers.excludes': 'Suspended, deactivated, pending verification.',
    'def.admin.users.activeUsers.caveats': 'Status, not recent activity.',
    'def.admin.users.newUsersInRange.definition': 'Accounts registered inside the dates.',
    'def.admin.users.newUsersInRange.includes': 'Every status.',
    'def.admin.users.newUsersInRange.excludes': 'None.',
    'def.admin.users.suspendedUsers.definition': 'Accounts currently suspended.',
    'def.admin.users.suspendedUsers.includes': 'As described.',
    'def.admin.users.suspendedUsers.excludes': 'Others.',
    'def.admin.users.totalUsers.definition':
      'All accounts ever registered (whatever their status).',
    'def.admin.users.totalUsers.includes': 'Every status.',
    'def.admin.users.totalUsers.excludes': 'None.',
    'def.farm.animals.animalsOnFarm.definition':
      'Animals currently recorded as active or for sale.',
    'def.farm.animals.animalsOnFarm.includes':
      'Active and for-sale animals (optionally of one animal type).',
    'def.farm.animals.animalsOnFarm.excludes':
      'Sold, deceased, transferred, lost and archived animals.',
    'def.farm.animals.totalRecorded.definition':
      'Every non-archived animal record whatever its status.',
    'def.farm.animals.totalRecorded.includes': 'All statuses.',
    'def.farm.animals.totalRecorded.excludes': 'Archived animals.',
    'def.farm.assessments.assessmentsAccepted.definition':
      'Assessments marked reviewed by the owner.',
    'def.farm.assessments.assessmentsAccepted.includes': 'As above.',
    'def.farm.assessments.assessmentsAccepted.excludes': 'Others.',
    'def.farm.assessments.assessmentsDismissed.definition': 'Assessments dismissed by the owner.',
    'def.farm.assessments.assessmentsDismissed.includes': 'As above.',
    'def.farm.assessments.assessmentsDismissed.excludes': 'Others.',
    'def.farm.assessments.assessmentsInRange.definition':
      'Sale assessments created for this farm’s animals in the dates.',
    'def.farm.assessments.assessmentsInRange.includes': 'All.',
    'def.farm.assessments.assessmentsInRange.excludes': 'None.',
    'def.farm.assessments.assessmentsInRange.caveats': 'Decision support, not advice.',
    'def.farm.assessments.assessmentsPending.definition':
      'Assessments in the dates that the owner has not reviewed or dismissed.',
    'def.farm.assessments.assessmentsPending.includes': 'As above.',
    'def.farm.assessments.assessmentsPending.excludes': 'Reviewed/dismissed.',
    'def.farm.assessments.highConfidence.definition':
      'Assessments whose data-completeness indicator is high.',
    'def.farm.assessments.highConfidence.includes': 'As above.',
    'def.farm.assessments.highConfidence.excludes': 'Others.',
    'def.farm.assessments.lowConfidence.definition':
      'Assessments whose data-completeness indicator is low.',
    'def.farm.assessments.lowConfidence.includes': 'As above.',
    'def.farm.assessments.lowConfidence.excludes': 'Others.',
    'def.farm.assessments.lowConfidence.caveats':
      'A completeness indicator, not a statistical probability.',
    'def.farm.assessments.withPriceRange.definition':
      'Assessments for which enough authorised market data existed to suggest a range.',
    'def.farm.assessments.withPriceRange.includes': 'As above.',
    'def.farm.assessments.withPriceRange.excludes': 'Others.',
    'def.farm.costs.costAssignedToAnimalsMinor.definition':
      'Part of the recorded costs that names an animal.',
    'def.farm.costs.costAssignedToAnimalsMinor.includes': 'As above.',
    'def.farm.costs.costAssignedToAnimalsMinor.excludes': 'Farm-wide costs.',
    'def.farm.costs.expenseRecords.definition':
      'Number of expense records behind the recorded costs.',
    'def.farm.costs.expenseRecords.includes': 'As above.',
    'def.farm.costs.expenseRecords.excludes': 'Voided.',
    'def.farm.costs.farmWideCostMinor.definition':
      'Part of the recorded costs not assigned to any animal (shared feed, labour, equipment).',
    'def.farm.costs.farmWideCostMinor.includes': 'As above.',
    'def.farm.costs.farmWideCostMinor.excludes': 'Costs assigned to an animal.',
    'def.farm.costs.farmWideCostMinor.caveats':
      'Not allocated to animals: FARM+ does not guess shares.',
    'def.farm.costs.recordedCostMinor.definition': 'Expenses recorded inside the selected days.',
    'def.farm.costs.recordedCostMinor.includes': 'Costs assigned to an animal and farm-wide costs.',
    'def.farm.costs.recordedCostMinor.excludes': 'Voided expenses. Anything not recorded in FARM+.',
    'def.farm.costs.recordedCostMinor.caveats':
      'Recorded costs only — not total cost. With an animal-type filter only costs assigned to animals of that type are counted.',
    'def.farm.feeding.animalsFed.definition':
      'Different animals named in a feeding log in the dates.',
    'def.farm.feeding.animalsFed.includes': 'Per-animal logs.',
    'def.farm.feeding.animalsFed.excludes': 'Group logs (no animal named) and voided records.',
    'def.farm.feeding.feedingLogsInRange.definition':
      'Feeding log entries dated inside the selected days.',
    'def.farm.feeding.feedingLogsInRange.includes': 'Per-animal and group logs.',
    'def.farm.feeding.feedingLogsInRange.excludes': 'Schedules (plans) and voided records.',
    'def.farm.feeding.groupFeedingLogs.definition':
      'Feeding logs for a group rather than a named animal.',
    'def.farm.feeding.groupFeedingLogs.includes': 'As above.',
    'def.farm.feeding.groupFeedingLogs.excludes': 'Voided.',
    'def.farm.growth.animalsWeighed.definition':
      'Different animals with at least one weighing in the dates.',
    'def.farm.growth.animalsWeighed.includes': 'Same as weighings.',
    'def.farm.growth.animalsWeighed.excludes': 'Voided records.',
    'def.farm.growth.animalsWithGainEstimate.definition':
      'Animals weighed at least twice, a week or more apart, inside the dates.',
    'def.farm.growth.animalsWithGainEstimate.includes': 'As above.',
    'def.farm.growth.animalsWithGainEstimate.excludes':
      'Animals with a single weighing or weighings closer than 7 days.',
    'def.farm.growth.animalsWithGainEstimate.caveats':
      'Closer readings are mostly measurement noise.',
    'def.farm.growth.averageDailyGainG.definition':
      'Mean of each animal’s average daily weight gain across the dates.',
    'def.farm.growth.averageDailyGainG.includes':
      'Animals counted in “Animals with a gain estimate”.',
    'def.farm.growth.averageDailyGainG.excludes':
      'All other animals (not zero: they are left out).',
    'def.farm.growth.averageDailyGainG.caveats':
      'Unweighted mean of animals, not herd-weighted. Includes tape/visual estimates.',
    'def.farm.growth.estimatedWeightShare.definition':
      'Share of weighings that were tape or visual estimates rather than a scale reading.',
    'def.farm.growth.estimatedWeightShare.includes': 'All weighings in the dates.',
    'def.farm.growth.estimatedWeightShare.excludes': 'Voided records.',
    'def.farm.growth.weighingsInRange.definition': 'Weight records dated inside the selected days.',
    'def.farm.growth.weighingsInRange.includes': 'Scale, tape and visual weights.',
    'def.farm.growth.weighingsInRange.excludes': 'Voided records.',
    'def.farm.health.animalsWithIllnessOrTreatment.definition':
      'Different animals that have an illness or treatment record in the dates.',
    'def.farm.health.animalsWithIllnessOrTreatment.includes': 'As above.',
    'def.farm.health.animalsWithIllnessOrTreatment.excludes': 'Voided.',
    'def.farm.health.healthRecordsInRange.definition':
      'Health records dated inside the selected days.',
    'def.farm.health.healthRecordsInRange.includes':
      'Illness, treatment, vaccination, recovery, checkup, other.',
    'def.farm.health.healthRecordsInRange.excludes': 'Voided records.',
    'def.farm.health.healthRecordsInRange.caveats':
      'Counts of what was recorded. FARM+ does not interpret health records.',
    'def.farm.health.illnessRecords.definition': 'Health records of type illness in the dates.',
    'def.farm.health.illnessRecords.includes': 'As above.',
    'def.farm.health.illnessRecords.excludes': 'Voided.',
    'def.farm.health.treatmentRecords.definition': 'Health records of type treatment in the dates.',
    'def.farm.health.treatmentRecords.includes': 'As above.',
    'def.farm.health.treatmentRecords.excludes': 'Voided.',
    'def.farm.health.vaccinationRecords.definition':
      'Health records of type vaccination in the dates.',
    'def.farm.health.vaccinationRecords.includes': 'As above.',
    'def.farm.health.vaccinationRecords.excludes': 'Voided.',
    'def.farm.health.vaccinationsDueNext30Days.definition':
      'Different animals whose recorded “next due” date falls within the next 30 days.',
    'def.farm.health.vaccinationsDueNext30Days.includes': 'All health records.',
    'def.farm.health.vaccinationsDueNext30Days.excludes': 'Voided records.',
    'def.farm.health.vaccinationsDueNext30Days.caveats': 'Only due dates that were recorded.',
    'def.farm.health.withdrawalsRunning.definition':
      'Different animals with a recorded medicine withdrawal period that has not ended yet.',
    'def.farm.health.withdrawalsRunning.includes': 'All health records, whatever their date.',
    'def.farm.health.withdrawalsRunning.excludes': 'Voided records.',
    'def.farm.health.withdrawalsRunning.caveats': 'Only periods that were recorded.',
    'def.farm.listings.activeListings.definition': 'Animal listings currently on sale.',
    'def.farm.listings.activeListings.includes': 'Listings of this farm.',
    'def.farm.listings.activeListings.excludes':
      'Draft, pending, reserved, paused, sold, expired, cancelled.',
    'def.farm.listings.listingsCreatedInRange.definition':
      'Listings created inside the selected days.',
    'def.farm.listings.listingsCreatedInRange.includes': 'Any status.',
    'def.farm.listings.listingsCreatedInRange.excludes': 'None.',
    'def.farm.listings.pendingReviewListings.definition':
      'Listings submitted and waiting for a moderator.',
    'def.farm.listings.pendingReviewListings.includes': 'This farm.',
    'def.farm.listings.pendingReviewListings.excludes': 'Others.',
    'def.farm.listings.reservedListings.definition':
      'Listings with an accepted deal waiting for checkout/payment.',
    'def.farm.listings.reservedListings.includes': 'This farm.',
    'def.farm.listings.reservedListings.excludes': 'Others.',
    'def.farm.products.activeProducts.definition': 'Shop products currently on sale.',
    'def.farm.products.activeProducts.includes': 'This farm.',
    'def.farm.products.activeProducts.excludes': 'Other statuses.',
    'def.farm.products.lowStockProducts.definition':
      'Active products with something available but at or below their own low-stock warning level.',
    'def.farm.products.lowStockProducts.includes': 'Products that have a warning level.',
    'def.farm.products.lowStockProducts.excludes': 'Products without one.',
    'def.farm.products.outOfStockProducts.definition':
      'Active products with nothing available to order.',
    'def.farm.products.outOfStockProducts.includes': 'This farm.',
    'def.farm.products.outOfStockProducts.excludes': 'Other statuses.',
    'def.farm.products.pendingReviewProducts.definition':
      'Products submitted and waiting for a moderator.',
    'def.farm.products.pendingReviewProducts.includes': 'This farm.',
    'def.farm.products.pendingReviewProducts.excludes': 'Others.',
    'def.farm.products.productGrossSalesMinor.definition':
      'Gross sales from shop orders (the shop part of Gross sales).',
    'def.farm.products.productGrossSalesMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates (shop orders)',
    'def.farm.products.productGrossSalesMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.products.productGrossSalesMinor.caveats':
      'Equals Gross sales when filtered to shop orders.',
    'def.farm.products.unitsSold.definition': 'Units on paid, standing shop orders in the dates.',
    'def.farm.products.unitsSold.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates (shop orders)',
    'def.farm.products.unitsSold.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.sales.averageOrderValueMinor.definition': 'Gross sales per paid order.',
    'def.farm.sales.averageOrderValueMinor.includes': 'As gross sales.',
    'def.farm.sales.averageOrderValueMinor.excludes': 'As gross sales.',
    'def.farm.sales.cancelledOrders.definition':
      'Orders placed inside the dates and cancelled (never paid, or expired).',
    'def.farm.sales.cancelledOrders.includes': 'As described.',
    'def.farm.sales.cancelledOrders.excludes': 'Refunded orders.',
    'def.farm.sales.estimatedNetProceedsMinor.definition':
      'Gross sales minus platform commission: what the sales are expected to pay out to the farm.',
    'def.farm.sales.estimatedNetProceedsMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.farm.sales.estimatedNetProceedsMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.sales.estimatedNetProceedsMinor.caveats':
      'ESTIMATED: before the seller’s shipping costs, payment-provider fees, taxes and costs outside FARM+. Not profit.',
    'def.farm.sales.grossSalesMinor.definition':
      'Item price of paid, standing orders. Shipping is not part of it.',
    'def.farm.sales.grossSalesMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.farm.sales.grossSalesMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.sales.grossSalesMinor.caveats':
      'Not profit, not revenue after fees: see Estimated net proceeds.',
    'def.farm.sales.netProceedsOverRecordedCostMinor.definition':
      'Estimated net proceeds minus recorded costs in the same dates. A rough indicator, shown only if you may see costs.',
    'def.farm.sales.netProceedsOverRecordedCostMinor.includes': 'Both as defined above.',
    'def.farm.sales.netProceedsOverRecordedCostMinor.excludes':
      'Costs that were not recorded; timing differences (an animal’s costs span many months).',
    'def.farm.sales.netProceedsOverRecordedCostMinor.caveats':
      'NOT PROFIT: unrecorded costs, shipping costs, taxes and fees are not in it, and costs and sales of different animals fall in different periods.',
    'def.farm.sales.netProceedsPendingMinor.definition':
      'Part of the estimated net proceeds from orders paid but not yet delivered (held until delivery).',
    'def.farm.sales.netProceedsPendingMinor.includes': 'Paid orders in progress.',
    'def.farm.sales.netProceedsPendingMinor.excludes': 'Delivered orders.',
    'def.farm.sales.netProceedsReleasedMinor.definition':
      'Part of the estimated net proceeds from orders already delivered: earnings that became withdrawable.',
    'def.farm.sales.netProceedsReleasedMinor.includes': 'Paid orders that reached DELIVERED.',
    'def.farm.sales.netProceedsReleasedMinor.excludes': 'Orders still in progress.',
    'def.farm.sales.ordersCreated.definition': 'Orders created for this farm inside the dates.',
    'def.farm.sales.ordersCreated.includes': 'Every status.',
    'def.farm.sales.ordersCreated.excludes': 'None.',
    'def.farm.sales.ordersCreated.caveats': 'Includes orders never paid.',
    'def.farm.sales.ordersPaid.definition':
      'Orders whose payment was confirmed inside the dates and that still stand.',
    'def.farm.sales.ordersPaid.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.farm.sales.ordersPaid.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.sales.platformCommissionMinor.definition':
      'The fee FARM+ keeps from those sales, as fixed on each order at checkout.',
    'def.farm.sales.platformCommissionMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.farm.sales.platformCommissionMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'def.farm.sales.platformCommissionMinor.caveats':
      'Later changes to commission rules never alter it.',
    'def.farm.sales.refundedGrossMinor.definition':
      'Item price of orders paid inside the dates that are now REFUND_PENDING or REFUNDED. Excluded from gross sales.',
    'def.farm.sales.refundedGrossMinor.includes': 'As described.',
    'def.farm.sales.refundedGrossMinor.excludes': 'Everything else.',
    'def.farm.sales.shippingCollectedMinor.definition':
      'Delivery charges buyers paid on those orders. Kept apart from sales: it is passed on, not income from the goods.',
    'def.farm.sales.shippingCollectedMinor.includes':
      'orders in status PAID, PROCESSING, SHIPPED or DELIVERED whose payment was confirmed (paidAt) inside the dates',
    'def.farm.sales.shippingCollectedMinor.excludes':
      'orders that were cancelled before payment, and paid orders now REFUND_PENDING or REFUNDED (they are shown separately as excluded/refunded)',
    'alert.unapplied_payments':
      '{count} payment(s) were received but could not be applied to an order ({amount} parked, refund needed).',
    'alert.failed_refunds': '{count} refund(s) failed at the provider and need a retry.',
    'alert.failed_payouts':
      '{count} payout(s) failed in the last 7 days (funds were returned to the sellers).',
    'alert.stale_withdrawals':
      '{count} withdrawal request(s) have waited more than 3 days for a decision.',
    'alert.payment_failure_rate':
      '{count} of {total} payments failed in the last 24 hours ({percent}%).',
    'alert.stale_payment_attempts':
      '{count} payment attempt(s) are past their window and not yet expired (the cleanup job handles them).',
  },
});
