import unittest
from decimal import Decimal
from scalp_goals import assess,entry_risk_budget,GoalError

class Tests(unittest.TestCase):
    def test_goal_uses_net_closed_bot_profit(self):
        self.assertTrue(assess('1000','100','100','5000',history_complete=True)['goal_reached'])
        self.assertFalse(assess('1000','100','99.99','5000',history_complete=True)['goal_reached'])
        self.assertEqual(assess(100,20,20,1000,history_complete=True)['target_total'],Decimal('120'))
    def test_requires_verified_history(self):
        with self.assertRaises(GoalError):assess(1000,100,100,5000,history_complete=False)
        with self.assertRaises(GoalError):assess(1000,100,100,5000,history_complete=1)
    def test_reject_invalid_allocations(self):
        for args in ((0,100,0,100),(100,0,0,100),(100,200,0,99),(100,200,0,0)):
            with self.subTest(args=args),self.assertRaises(GoalError):assess(*args,history_complete=True)
    def test_non_finite_rejected(self):
        with self.assertRaises(GoalError):assess('NaN',200,0,300,history_complete=True)
    def test_fraction_and_loss_adjustment(self):
        self.assertEqual(entry_risk_budget(1000,2000,-200),Decimal('2.0000'))
        self.assertEqual(entry_risk_budget(1000,1000,500),Decimal('2.5000'))
    def test_reject_empty_virtual_capital_and_large_risk(self):
        with self.assertRaises(GoalError):entry_risk_budget(1000,1000,-1000)
        with self.assertRaises(GoalError):entry_risk_budget(1000,1000,0,.02)

if __name__=='__main__':unittest.main()
